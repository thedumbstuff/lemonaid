const test = require('node:test');
const assert = require('node:assert');
const { createApp } = require('../src/app');

let server, base, db;
test.before(async () => {
  const app = createApp({ dbFile: ':memory:' });
  db = app.locals.db;
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server.close());

const post = (url, body, headers = {}) =>
  fetch(base + url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });

// The code in the newest email sent to this address (what a person would read in their inbox).
function lastCode(email) {
  const mail = db.prepare('SELECT * FROM mailbox WHERE to_email = ? ORDER BY id DESC').get(email);
  return /\b(\d{6})\b/.exec(mail.subject)[1];
}

test('asking for a code sends an email with a 6-digit code', async () => {
  const res = await post('/api/auth/request-code', { email: 'Ana.Smith@Example.com' });
  assert.equal(res.status, 200);
  assert.match(lastCode('ana.smith@example.com'), /^\d{6}$/);
});

test('a bad email address is refused', async () => {
  for (const email of ['', 'nope', 'a@b', undefined, 42]) {
    assert.equal((await post('/api/auth/request-code', { email })).status, 400);
  }
});

test('the right code signs you in, with a short public name (not the email)', async () => {
  await post('/api/auth/request-code', { email: 'ana.smith@example.com' });
  const code = lastCode('ana.smith@example.com');
  const res = await post('/api/auth/verify-code', { email: 'ana.smith@example.com', code });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.user.name, 'ana.smith');
  assert.ok(data.token.length >= 20);
  assert.ok(!JSON.stringify(data).includes('example.com'));

  const me = await fetch(base + '/api/auth/me', { headers: { Authorization: 'Bearer ' + data.token } });
  assert.equal(me.status, 200);
  assert.equal((await me.json()).user.name, 'ana.smith');

  // A code works only once.
  const again = await post('/api/auth/verify-code', { email: 'ana.smith@example.com', code });
  assert.equal(again.status, 400);

  // Signing out ends the session.
  await post('/api/auth/logout', {}, { Authorization: 'Bearer ' + data.token });
  const after = await fetch(base + '/api/auth/me', { headers: { Authorization: 'Bearer ' + data.token } });
  assert.equal(after.status, 401);
});

test('a wrong code is refused, and after 5 wrong tries even the right code stops working', async () => {
  await post('/api/auth/request-code', { email: 'bob@example.com' });
  const right = lastCode('bob@example.com');
  const wrong = right === '000000' ? '111111' : '000000';
  for (let i = 0; i < 5; i++) {
    assert.equal((await post('/api/auth/verify-code', { email: 'bob@example.com', code: wrong })).status, 400);
  }
  assert.equal((await post('/api/auth/verify-code', { email: 'bob@example.com', code: right })).status, 400);
});

test('an expired code is refused', async () => {
  await post('/api/auth/request-code', { email: 'carol@example.com' });
  const code = lastCode('carol@example.com');
  db.prepare('UPDATE login_codes SET expires_at = ? WHERE email = ?').run(Date.now() - 1000, 'carol@example.com');
  const res = await post('/api/auth/verify-code', { email: 'carol@example.com', code });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /expired/);
});

test('asking for a new code cancels the old one', async () => {
  await post('/api/auth/request-code', { email: 'dave@example.com' });
  const first = lastCode('dave@example.com');
  let second = first;
  while (second === first) {
    await post('/api/auth/request-code', { email: 'dave@example.com' });
    second = lastCode('dave@example.com');
  }
  assert.equal((await post('/api/auth/verify-code', { email: 'dave@example.com', code: first })).status, 400);
});

test('too many codes for one email in an hour are refused', async () => {
  let last;
  for (let i = 0; i < 6; i++) last = await post('/api/auth/request-code', { email: 'spam@example.com' });
  assert.equal(last.status, 429);
});

test('you are not signed in without a valid token', async () => {
  assert.equal((await fetch(base + '/api/auth/me')).status, 401);
  assert.equal((await fetch(base + '/api/auth/me', { headers: { Authorization: 'Bearer nottherealtokennottherealtoken' } })).status, 401);
});

test('the test mailbox page shows the emails, safely', async () => {
  db.prepare('INSERT INTO mailbox (to_email, subject, body) VALUES (?, ?, ?)').run('x@y.com', '<script>alert(1)</script>', 'hi');
  const html = await (await fetch(base + '/mailbox')).text();
  assert.match(html, /Your Lemonaid code/);
  assert.ok(!html.includes('<script>alert(1)</script>'));
});

test('the test mailbox is switched off when asked (production)', async () => {
  const app = createApp({ dbFile: ':memory:', testMailbox: false });
  const s = await new Promise((resolve) => { const x = app.listen(0, () => resolve(x)); });
  const res = await fetch(`http://127.0.0.1:${s.address().port}/mailbox`);
  s.close();
  assert.equal(res.status, 404);
});
