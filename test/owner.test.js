const test = require('node:test');
const assert = require('node:assert');
const { createApp } = require('../src/app');

const OWNER = 'boss@example.com';
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
const newTopic = async (title, who = 'ann') =>
  send('POST', '/api/topics', { title, label: 'bug', body: 'Some text' }, tokens[who]);
const visibleTitles = async () => (await (await send('GET', '/api/topics')).json()).topics.map((t) => t.title);
const userId = (email) => db.prepare('SELECT id FROM users WHERE email = ?').get(email).id;

test.before(async () => {
  const app = createApp({ topicsPerDay: 1000, dbFile: ':memory:', ownerEmail: OWNER });
  db = app.locals.db;
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  tokens.owner = await signIn(OWNER);
  tokens.ann = await signIn('ann@example.com');
  tokens.bob = await signIn('bob@example.com');
});
test.after(() => server.close());

test('only the owner is the owner', async () => {
  assert.equal((await (await send('GET', '/api/auth/me', undefined, tokens.owner)).json()).user.is_owner, true);
  assert.equal((await (await send('GET', '/api/auth/me', undefined, tokens.ann)).json()).user.is_owner, false);
});

test('the owner tools refuse everyone else', async () => {
  const id = (await (await newTopic('Not yours')).json()).id;
  for (const [method, url, body] of [
    ['GET', '/api/admin/overview'],
    ['POST', `/api/admin/topic/${id}/status`, { status: 'fixed' }],
    ['POST', `/api/admin/topic/${id}/state`, { state: 'deleted' }],
    ['POST', `/api/admin/users/${userId('bob@example.com')}`, { blocked: true }],
  ]) {
    assert.equal((await send(method, url, body, tokens.ann)).status, 403, url);
    assert.equal((await send(method, url, body)).status, 401, url);
  }
});

test('the owner can set a status, and the board filters by it', async () => {
  const id = (await (await newTopic('Status topic')).json()).id;
  assert.equal((await send('POST', `/api/admin/topic/${id}/status`, { status: 'planned' }, tokens.owner)).status, 200);
  const planned = (await (await send('GET', '/api/topics?status=planned')).json()).topics;
  assert.ok(planned.some((t) => t.id === id));
  assert.equal((await send('POST', `/api/admin/topic/${id}/status`, { status: 'weird' }, tokens.owner)).status, 400);
  assert.equal((await send('POST', `/api/admin/topic/9999/status`, { status: 'fixed' }, tokens.owner)).status, 404);
});

test('deleting a topic hides it everywhere, and it can be brought back', async () => {
  const id = (await (await newTopic('Delete me')).json()).id;
  assert.equal((await send('POST', `/api/admin/topic/${id}/state`, { state: 'deleted' }, tokens.owner)).status, 200);
  assert.ok(!(await visibleTitles()).includes('Delete me'));
  assert.equal((await send('GET', '/api/topics/' + id)).status, 404);
  assert.equal((await send('POST', `/api/topics/${id}/replies`, { body: 'hi' }, tokens.bob)).status, 404);
  assert.equal((await send('POST', `/api/topics/${id}/vote`, {}, tokens.bob)).status, 404);
  const overview = await (await send('GET', '/api/admin/overview', undefined, tokens.owner)).json();
  assert.ok(overview.deleted.some((p) => p.kind === 'topic' && p.id === id));
  await send('POST', `/api/admin/topic/${id}/state`, { state: 'visible' }, tokens.owner);
  assert.ok((await visibleTitles()).includes('Delete me'));
});

test('deleting a reply hides it and lowers the reply count', async () => {
  const id = (await (await newTopic('With replies')).json()).id;
  const reply = (await (await send('POST', `/api/topics/${id}/replies`, { body: 'First' }, tokens.bob)).json()).id;
  const count = async () => (await (await send('GET', '/api/topics')).json()).topics.find((t) => t.id === id).reply_count;
  assert.equal(await count(), 1);
  await send('POST', `/api/admin/reply/${reply}/state`, { state: 'deleted' }, tokens.owner);
  assert.equal(await count(), 0);
  assert.equal((await (await send('GET', '/api/topics/' + id)).json()).replies.length, 0);
});

test('a flagged person has their posts held until the owner lets them through', async () => {
  await send('POST', `/api/admin/users/${userId('bob@example.com')}`, { flagged: true }, tokens.owner);
  const res = await newTopic('Held topic', 'bob');
  assert.equal(res.status, 201);
  const made = await res.json();
  assert.equal(made.held, true);
  assert.ok(!(await visibleTitles()).includes('Held topic'));
  assert.equal((await send('GET', '/api/topics/' + made.id)).status, 404);

  const topicId = (await (await newTopic('Normal topic')).json()).id;
  const reply = await (await send('POST', `/api/topics/${topicId}/replies`, { body: 'Held reply' }, tokens.bob)).json();
  assert.equal(reply.held, true);
  assert.equal((await (await send('GET', '/api/topics/' + topicId)).json()).replies.length, 0);

  const overview = await (await send('GET', '/api/admin/overview', undefined, tokens.owner)).json();
  assert.ok(overview.held.some((p) => p.kind === 'topic' && p.id === made.id));
  assert.ok(overview.held.some((p) => p.kind === 'reply' && p.id === reply.id));

  await send('POST', `/api/admin/topic/${made.id}/state`, { state: 'visible' }, tokens.owner);
  assert.ok((await visibleTitles()).includes('Held topic'));

  // unflag: new posts go straight through again
  await send('POST', `/api/admin/users/${userId('bob@example.com')}`, { flagged: false }, tokens.owner);
  assert.equal((await (await newTopic('Free again', 'bob')).json()).held, false);
});

test('a blocked person cannot post, reply, vote or add pictures, but can still read', async () => {
  const id = (await (await newTopic('For blocked')).json()).id;
  await send('POST', `/api/admin/users/${userId('bob@example.com')}`, { blocked: true }, tokens.owner);
  assert.equal((await newTopic('Nope', 'bob')).status, 403);
  assert.equal((await send('POST', `/api/topics/${id}/replies`, { body: 'hi' }, tokens.bob)).status, 403);
  assert.equal((await send('POST', `/api/topics/${id}/vote`, {}, tokens.bob)).status, 403);
  const pic = await fetch(base + '/api/images', { method: 'POST', headers: { Authorization: 'Bearer ' + tokens.bob }, body: Buffer.alloc(20, 1) });
  assert.equal(pic.status, 403);
  assert.equal((await send('GET', '/api/topics')).status, 200);
  assert.equal((await send('GET', '/api/auth/me', undefined, tokens.bob)).status, 200);
  await send('POST', `/api/admin/users/${userId('bob@example.com')}`, { blocked: false }, tokens.owner);
  assert.equal((await newTopic('Back again', 'bob')).status, 201);
});

test('the owner cannot flag or block themselves', async () => {
  const res = await send('POST', `/api/admin/users/${userId(OWNER)}`, { blocked: true }, tokens.owner);
  assert.equal(res.status, 400);
});

test('only the owner sees who wrote a post, and email addresses', async () => {
  const id = (await (await newTopic('Who wrote')).json()).id;
  const asOwner = (await (await send('GET', '/api/topics/' + id, undefined, tokens.owner)).json()).topic;
  const asAnn = (await (await send('GET', '/api/topics/' + id, undefined, tokens.ann)).json()).topic;
  const anon = (await (await send('GET', '/api/topics/' + id)).json()).topic;
  assert.equal(asOwner.author_id, userId('ann@example.com'));
  assert.equal(asAnn.author_id, undefined);
  assert.equal(anon.author_id, undefined);
  const overview = await (await send('GET', '/api/admin/overview', undefined, tokens.owner)).json();
  assert.ok(overview.users.some((u) => u.email === 'ann@example.com'));
  assert.ok(!JSON.stringify(await (await send('GET', '/api/topics')).json()).includes('example.com'));
});

test('without an owner set, nobody is the owner (production)', async () => {
  const app = createApp({ topicsPerDay: 1000, dbFile: ':memory:', testMailbox: false });
  const s = await new Promise((resolve) => { const x = app.listen(0, () => resolve(x)); });
  const url = `http://127.0.0.1:${s.address().port}`;
  const config = await (await fetch(url + '/api/config')).json();
  const overview = await fetch(url + '/api/admin/overview');
  s.close();
  assert.equal(config.demoOwnerEmail, null);
  assert.equal(overview.status, 401);
});

test('in try-out mode the demo page is told which email is the owner', async () => {
  const app = createApp({ topicsPerDay: 1000, dbFile: ':memory:' });
  const s = await new Promise((resolve) => { const x = app.listen(0, () => resolve(x)); });
  const config = await (await fetch(`http://127.0.0.1:${s.address().port}/api/config`)).json();
  s.close();
  assert.equal(config.demoOwnerEmail, 'owner@lemonaid.local');
});
