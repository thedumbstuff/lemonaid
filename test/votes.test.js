const test = require('node:test');
const assert = require('node:assert');
const { createApp } = require('../src/app');

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
const newTopic = async (title, label) =>
  (await (await send('POST', '/api/topics', { title, label, body: 'Some text' }, tokens.a)).json()).id;
const titles = async (q = '', auth) => (await (await send('GET', '/api/topics' + q, undefined, auth)).json()).topics.map((t) => t.title);

test.before(async () => {
  const app = createApp({ topicsPerDay: 1000, dbFile: ':memory:' });
  db = app.locals.db;
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  tokens.a = await signIn('a@example.com');
  tokens.b = await signIn('b@example.com');
});
test.after(() => server.close());

test('you must be signed in to upvote', async () => {
  const id = await newTopic('Needs sign in', 'idea');
  assert.equal((await send('POST', `/api/topics/${id}/vote`)).status, 401);
});

test('upvote once per person, press again to take it back', async () => {
  const id = await newTopic('Vote me', 'idea');
  let r = await (await send('POST', `/api/topics/${id}/vote`, {}, tokens.a)).json();
  assert.deepEqual(r, { voted: true, vote_count: 1 });
  r = await (await send('POST', `/api/topics/${id}/vote`, {}, tokens.b)).json();
  assert.deepEqual(r, { voted: true, vote_count: 2 });
  r = await (await send('POST', `/api/topics/${id}/vote`, {}, tokens.a)).json();
  assert.deepEqual(r, { voted: false, vote_count: 1 });
});

test('the board says whether you voted, and counts on the topic page', async () => {
  const id = await newTopic('Did I vote', 'idea');
  await send('POST', `/api/topics/${id}/vote`, {}, tokens.a);
  const mine = (await (await send('GET', '/api/topics', undefined, tokens.a)).json()).topics.find((t) => t.id === id);
  const theirs = (await (await send('GET', '/api/topics', undefined, tokens.b)).json()).topics.find((t) => t.id === id);
  const anon = (await (await send('GET', '/api/topics')).json()).topics.find((t) => t.id === id);
  assert.equal(mine.voted, true);
  assert.equal(theirs.voted, false);
  assert.equal(anon.voted, false);
  assert.equal(anon.vote_count, 1);
  const page = await (await send('GET', '/api/topics/' + id, undefined, tokens.a)).json();
  assert.equal(page.topic.vote_count, 1);
  assert.equal(page.topic.voted, true);
});

test('voting on a topic that does not exist is refused', async () => {
  assert.equal((await send('POST', '/api/topics/9999/vote', {}, tokens.a)).status, 404);
});

test('most wanted comes first, newest is available too', async () => {
  const low = await newTopic('Sort low', 'idea');
  const high = await newTopic('Sort high', 'idea');
  await send('POST', `/api/topics/${high}/vote`, {}, tokens.a);
  await send('POST', `/api/topics/${high}/vote`, {}, tokens.b);
  await send('POST', `/api/topics/${low}/vote`, {}, tokens.a);
  const top = await titles('?sort=top');
  assert.ok(top.indexOf('Sort high') < top.indexOf('Sort low'));
  const fresh = await titles('?sort=new');
  assert.equal(fresh[0], 'Sort high'); // posted last
  assert.ok(fresh.indexOf('Sort high') < fresh.indexOf('Sort low'));
});

test('filters by label and status', async () => {
  const bug = await newTopic('A filter bug', 'bug');
  await newTopic('A filter question', 'question');
  db.prepare("UPDATE topics SET status = 'fixed' WHERE id = ?").run(bug);
  assert.deepEqual(await titles('?label=bug'), ['A filter bug']);
  assert.deepEqual(await titles('?label=question&sort=new'), ['A filter question']);
  assert.deepEqual(await titles('?status=fixed'), ['A filter bug']);
  assert.deepEqual(await titles('?status=fixed&label=question'), []);
  // an unknown filter value is ignored (shows everything)
  assert.ok((await titles('?label=nonsense')).length > 2);
});
