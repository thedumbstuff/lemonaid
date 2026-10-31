const test = require('node:test');
const assert = require('node:assert');
const nodemailer = require('nodemailer');
const { createApp } = require('../src/app');
const { createMailer } = require('../src/mailer');

let server, base, db;
const tokens = {};
const send = (method, url, body, auth) =>
  fetch(base + url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: 'Bearer ' + auth } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
async function signIn(email) {
  await send('POST', '/api/auth/request-code', { email });
  const code = /(\d{6})/.exec(db.prepare('SELECT subject FROM mailbox WHERE to_email = ? ORDER BY id DESC').get(email).subject)[1];
  return (await (await send('POST', '/api/auth/verify-code', { email, code })).json()).token;
}
const mailsTo = (email) => db.prepare('SELECT * FROM mailbox WHERE to_email = ? ORDER BY id').all(email);
const replyMails = (email) => mailsTo(email).filter((m) => / replied to /.test(m.subject));
const newTopic = async (who, title = 'My topic') =>
  (await (await send('POST', '/api/topics', { title, label: 'question', body: 'Hello' }, tokens[who])).json()).id;
const userId = (email) => db.prepare('SELECT id FROM users WHERE email = ?').get(email).id;

test.before(async () => {
  const app = createApp({ dbFile: ':memory:', ownerEmail: 'boss@example.com', publicUrl: 'https://board.example.com/' });
  db = app.locals.db;
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  for (const who of ['ann', 'bob', 'owner']) tokens[who] = await signIn(who === 'owner' ? 'boss@example.com' : who + '@example.com');
});
test.after(() => server.close());

test('the topic author gets an email when someone replies, with a link back', async () => {
  const id = await newTopic('ann', 'Why is it slow');
  await send('POST', `/api/topics/${id}/replies`, { body: 'Try **restarting** it.' }, tokens.bob);
  const [mail] = replyMails('ann@example.com');
  assert.equal(mail.subject, 'bob replied to "Why is it slow"');
  assert.match(mail.body, /> Try \*\*restarting\*\* it\./);
  assert.ok(mail.body.includes(`https://board.example.com/board/#/topic/${id}`));
  assert.match(mail.body, /Turn off reply emails: https:\/\/board\.example\.com\/unsubscribe\?u=\d+&t=[a-f0-9]{64}/);
  assert.ok(!mail.body.includes('bob@example.com'));
});

test('you do not get an email for your own reply, and others are not emailed', async () => {
  const before = replyMails('ann@example.com').length;
  const id = await newTopic('ann', 'Self reply');
  await send('POST', `/api/topics/${id}/replies`, { body: 'Answering myself' }, tokens.ann);
  assert.equal(replyMails('ann@example.com').length, before);
  assert.equal(replyMails('bob@example.com').length, 0);
});

test('the turn-off switch works from the board, and back on again', async () => {
  const me = await (await send('GET', '/api/auth/me', undefined, tokens.ann)).json();
  assert.equal(me.user.notify, true);
  assert.deepEqual(await (await send('POST', '/api/auth/notify', { enabled: false }, tokens.ann)).json(), { notify: false });
  const before = replyMails('ann@example.com').length;
  const id = await newTopic('ann', 'Quiet topic');
  await send('POST', `/api/topics/${id}/replies`, { body: 'Hi' }, tokens.bob);
  assert.equal(replyMails('ann@example.com').length, before);
  assert.equal((await send('POST', '/api/auth/notify', { enabled: 'yes' }, tokens.ann)).status, 400);
  assert.equal((await send('POST', '/api/auth/notify', { enabled: true })).status, 401);
  await send('POST', '/api/auth/notify', { enabled: true }, tokens.ann);
  await send('POST', `/api/topics/${id}/replies`, { body: 'Hi again' }, tokens.bob);
  assert.equal(replyMails('ann@example.com').length, before + 1);
});

test('the link in the email turns reply emails off, after asking first', async () => {
  const id = await newTopic('bob', 'Bob asks');
  await send('POST', `/api/topics/${id}/replies`, { body: 'Answer' }, tokens.ann);
  const url = /Turn off reply emails: (\S+)/.exec(replyMails('bob@example.com').at(-1).body)[1];
  const path = url.replace('https://board.example.com', '');

  const page = await fetch(base + path);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Turn off reply emails\?/);
  assert.equal(db.prepare('SELECT notify FROM users WHERE email = ?').get('bob@example.com').notify, 1); // just opening it changes nothing

  const params = new URL(url).searchParams;
  const done = await fetch(base + '/unsubscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ u: params.get('u'), t: params.get('t') }),
  });
  assert.equal(done.status, 200);
  assert.equal(db.prepare('SELECT notify FROM users WHERE email = ?').get('bob@example.com').notify, 0);
});

test('a made-up or changed unsubscribe link does nothing', async () => {
  const ann = userId('ann@example.com');
  assert.equal((await fetch(`${base}/unsubscribe?u=${ann}&t=${'0'.repeat(64)}`)).status, 400);
  assert.equal((await fetch(`${base}/unsubscribe?u=${ann}`)).status, 400);
  const res = await fetch(base + '/unsubscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ u: String(ann), t: 'abc' }),
  });
  assert.equal(res.status, 400);
  assert.equal(db.prepare('SELECT notify FROM users WHERE id = ?').get(ann).notify, 1);
});

test('a reply held for the owner is emailed only once the owner lets it through', async () => {
  const id = await newTopic('ann', 'Held reply topic');
  await send('POST', `/api/admin/users/${userId('bob@example.com')}`, { flagged: true }, tokens.owner);
  const before = replyMails('ann@example.com').length;
  const reply = await (await send('POST', `/api/topics/${id}/replies`, { body: 'Held one' }, tokens.bob)).json();
  assert.equal(reply.held, true);
  assert.equal(replyMails('ann@example.com').length, before);
  await send('POST', `/api/admin/reply/${reply.id}/state`, { state: 'visible' }, tokens.owner);
  assert.equal(replyMails('ann@example.com').length, before + 1);
  await send('POST', `/api/admin/users/${userId('bob@example.com')}`, { flagged: false }, tokens.owner);
});

test('real sending: the mailer hands emails to the email service', async () => {
  const transport = nodemailer.createTransport({ jsonTransport: true });
  const sent = [];
  const original = transport.sendMail.bind(transport);
  transport.sendMail = async (m) => { sent.push(m); return original(m); };
  const mailer = createMailer(db, { transport, mailFrom: 'Lemonaid <hello@example.com>', tryOutMode: false });
  assert.equal(mailer.mode, 'smtp');
  await mailer.send({ to: 'x@example.com', subject: 'Hi', body: 'There' });
  assert.deepEqual(sent.map((m) => [m.from, m.to, m.subject, m.text]), [['Lemonaid <hello@example.com>', 'x@example.com', 'Hi', 'There']]);
});

test('with no email service set up in production, sending fails clearly (never pretends)', async () => {
  const mailer = createMailer(db, { smtpUrl: '', tryOutMode: false });
  assert.equal(mailer.mode, 'off');
  await assert.rejects(() => mailer.send({ to: 'x@example.com', subject: 'Hi', body: 'There' }), /not set up/);

  const app = createApp({ dbFile: ':memory:', testMailbox: false, ownerEmail: 'boss@example.com' });
  const s = await new Promise((resolve) => { const x = app.listen(0, () => resolve(x)); });
  const res = await fetch(`http://127.0.0.1:${s.address().port}/api/auth/request-code`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'a@example.com' }),
  });
  s.close();
  assert.equal(res.status, 502);
  assert.match((await res.json()).error, /could not send/);
});

test('a failing email service does not break posting a reply', async () => {
  const transport = { sendMail: async () => { throw new Error('service down'); } };
  const app = createApp({ dbFile: ':memory:', ownerEmail: 'boss@example.com', mailTransport: transport });
  const own = app.locals.db;
  const s = await new Promise((resolve) => { const x = app.listen(0, () => resolve(x)); });
  const url = `http://127.0.0.1:${s.address().port}`;
  // sign-in codes cannot be sent either, so make two people directly
  const now = Date.now();
  const sessions = {};
  for (const who of ['p', 'q']) {
    const u = own.prepare("INSERT INTO users (email, name) VALUES (?, ?) RETURNING id").get(who + '@example.com', who);
    const token = 'tok' + who.repeat(30);
    own.prepare('INSERT INTO sessions (token_hash, user_id, created_at) VALUES (?, ?, ?)').run(require('node:crypto').createHash('sha256').update(token).digest('hex'), u.id, now);
    sessions[who] = token;
  }
  const j = (path, body, tok) => fetch(url + path, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok }, body: JSON.stringify(body) });
  const topic = await (await j('/api/topics', { title: 'Topic', label: 'idea', body: 'x' }, sessions.p)).json();
  const originalError = console.error;
  console.error = () => {};
  const reply = await j(`/api/topics/${topic.id}/replies`, { body: 'y' }, sessions.q);
  await new Promise((r) => setTimeout(r, 20));
  console.error = originalError;
  s.close();
  assert.equal(reply.status, 201);
});
