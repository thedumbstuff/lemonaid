// The board looks like a chat app: each topic shows its latest message, the list can be
// ordered by latest activity, and in a topic your own messages show on your side.
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
const list = async (q = '') => (await (await send('GET', '/api/topics' + q)).json()).topics;
const newTopic = async (title, body, who) => (await (await send('POST', '/api/topics', { title, label: 'idea', body }, tokens[who])).json()).id;
const reply = (id, body, who) => send('POST', `/api/topics/${id}/replies`, { body }, tokens[who]);

test.before(async () => {
  const app = createApp({ topicsPerDay: 1000, dbFile: ':memory:', ownerEmail: OWNER });
  db = app.locals.db;
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  tokens.ann = await signIn('ann@example.com');
  tokens.bob = await signIn('bob@example.com');
  tokens.owner = await signIn(OWNER);
});
test.after(() => server.close());

test('a topic without replies shows its own text as the latest message', async () => {
  const id = await newTopic('Dark mode please', 'It would be **easier** on the eyes.', 'ann');
  const t = (await list()).find((x) => x.id === id);
  assert.deepEqual({ author: t.last.author, text: t.last.text }, { author: 'ann', text: 'It would be easier on the eyes.' });
  assert.equal(t.last.at, t.created_at);
  assert.equal(t.body, undefined); // the full text is only sent when the topic is opened
});

test('the latest reply shows under the topic, as short plain text', async () => {
  const id = await newTopic('Export to CSV', 'Could we export?', 'ann');
  await reply(id, 'First answer', 'bob');
  await reply(id, 'Yes! See [the docs](https://example.com/docs) and\n\n```\nnpm run export\n```\n\n![shot](/uploads/' + 'a'.repeat(32) + '.png)', 'ann');
  const t = (await list()).find((x) => x.id === id);
  assert.equal(t.last.author, 'ann');
  assert.equal(t.last.text, 'Yes! See the docs and [code] 📷 Picture');
  assert.ok(!JSON.stringify(t).includes('example.com/docs')); // links are shortened to their words
});

test('long messages are cut short in the list', async () => {
  const id = await newTopic('Long one', 'word '.repeat(100), 'ann');
  const t = (await list()).find((x) => x.id === id);
  assert.ok(t.last.text.length <= 90);
  assert.ok(t.last.text.endsWith('…'));
});

test('held and deleted replies never show as the latest message', async () => {
  const id = await newTopic('Hidden replies', 'Topic text', 'ann');
  const kept = await (await reply(id, 'Shown reply', 'bob')).json();
  const gone = await (await reply(id, 'Deleted reply', 'bob')).json();
  await send('POST', `/api/admin/reply/${gone.id}/state`, { state: 'deleted' }, tokens.owner);
  await send('POST', `/api/admin/users/${db.prepare('SELECT id FROM users WHERE email = ?').get('bob@example.com').id}`, { flagged: true }, tokens.owner);
  await reply(id, 'Held reply', 'bob');
  await send('POST', `/api/admin/users/${db.prepare('SELECT id FROM users WHERE email = ?').get('bob@example.com').id}`, { flagged: false }, tokens.owner);
  const t = (await list()).find((x) => x.id === id);
  assert.equal(t.last.text, 'Shown reply');
  assert.ok(kept.id);
});

test('sort=active puts the topic with the newest message first', async () => {
  const older = await newTopic('Older topic', 'x', 'ann');
  const newer = await newTopic('Newer topic', 'x', 'ann');
  db.prepare("UPDATE topics SET created_at = datetime('now', '-2 days') WHERE id = ?").run(older);
  db.prepare("UPDATE topics SET created_at = datetime('now', '-1 hour') WHERE id = ?").run(newer);
  await reply(older, 'Fresh reply', 'bob');
  assert.equal((await list('?sort=active'))[0].id, older);
  assert.notEqual((await list('?sort=new'))[0].id, older);
});

test('in a topic, each message says if it is yours or the owner\'s, and never shows an email', async () => {
  const id = await newTopic('Whose is whose', 'Started by ann', 'ann');
  await reply(id, 'From bob', 'bob');
  await reply(id, 'From the owner', 'owner');
  const asAnn = await (await send('GET', '/api/topics/' + id, undefined, tokens.ann)).json();
  assert.equal(asAnn.topic.mine, true);
  assert.deepEqual(asAnn.replies.map((r) => [r.author, r.mine, r.by_owner]), [['bob', false, false], ['boss', false, true]]);
  const asBob = await (await send('GET', '/api/topics/' + id, undefined, tokens.bob)).json();
  assert.equal(asBob.topic.mine, false);
  assert.equal(asBob.replies[0].mine, true);
  const anon = await (await send('GET', '/api/topics/' + id)).json();
  assert.ok(anon.replies.every((r) => r.mine === false));
  for (const page of [asAnn, asBob, anon]) {
    assert.ok(!JSON.stringify(page).includes('@'));
    assert.equal(page.topic.author_id, undefined);
  }
});
