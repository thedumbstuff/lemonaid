const test = require('node:test');
const assert = require('node:assert');
const { checkText } = require('../src/moderation');
const { createApp } = require('../src/app');

test('rude words are caught, including simple tricks', () => {
  for (const text of ['you are a fuck', 'fuuuck this', 'fvck this', 'This is sh1t', 'Dont be a d1ck']) {
    assert.equal(checkText(text).ok, false, text);
  }
});

test('normal posts and words that only contain a bad one are fine', () => {
  for (const text of [
    'The login button is broken on Safari.',
    'I live in Scunthorpe',
    'Please assess the class assignment',
    'Cocktail bar menu, Essex, Sussex, grass, passion',
    'How do I hit the API? `curl -X POST`',
    '',
  ]) {
    assert.equal(checkText(text).ok, true, text);
  }
});

test('the friendly reason says what to do', () => {
  assert.match(checkText('fuck').reason, /reword/);
});

let server, base, db, token;
test.before(async () => {
  const app = createApp({ topicsPerDay: 1000, dbFile: ':memory:' });
  db = app.locals.db;
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  await send('POST', '/api/auth/request-code', { email: 'mod@example.com' });
  const code = /(\d{6})/.exec(db.prepare('SELECT subject FROM mailbox ORDER BY id DESC').get().subject)[1];
  token = (await (await send('POST', '/api/auth/verify-code', { email: 'mod@example.com', code })).json()).token;
});
test.after(() => server.close());
const send = (method, url, body, auth) =>
  fetch(base + url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: 'Bearer ' + auth } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

test('a topic with rude words in the title or the text is not posted', async () => {
  const before = (await (await send('GET', '/api/topics')).json()).topics.length;
  for (const t of [
    { title: 'This is shit', label: 'bug', body: 'fine text' },
    { title: 'Fine title', label: 'bug', body: 'what a piece of sh1t' },
  ]) {
    const res = await send('POST', '/api/topics', t, token);
    assert.equal(res.status, 422);
    assert.match((await res.json()).error, /not published/);
  }
  const after = (await (await send('GET', '/api/topics')).json()).topics.length;
  assert.equal(after, before);
});

test('a reply with rude words is not posted, a polite one is', async () => {
  const { id } = await (await send('POST', '/api/topics', { title: 'Polite topic', label: 'idea', body: 'Hello' }, token)).json();
  const bad = await send('POST', `/api/topics/${id}/replies`, { body: 'you idiot, fuck off' }, token);
  assert.equal(bad.status, 422);
  assert.equal((await send('POST', `/api/topics/${id}/replies`, { body: 'Thanks, great idea!' }, token)).status, 201);
  const page = await (await send('GET', '/api/topics/' + id)).json();
  assert.equal(page.replies.length, 1);
});
