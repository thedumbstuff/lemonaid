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
const newTopic = (who, n) => send('POST', '/api/topics', { title: `Topic number ${n}`, label: 'idea', body: 'Hello' }, tokens[who]);
const userId = (email) => db.prepare('SELECT id FROM users WHERE email = ?').get(email).id;

test.before(async () => {
  const app = createApp({ dbFile: ':memory:', ownerEmail: OWNER }); // the normal limit: 5 a day
  db = app.locals.db;
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  tokens.ann = await signIn('ann@example.com');
  tokens.bob = await signIn('bob@example.com');
  tokens.owner = await signIn(OWNER);
});
test.after(() => server.close());

test('a person can start 5 topics a day, and the 6th is refused with a friendly note', async () => {
  for (let n = 1; n <= 5; n++) assert.equal((await newTopic('ann', n)).status, 201, `topic ${n}`);
  const sixth = await newTopic('ann', 6);
  assert.equal(sixth.status, 429);
  assert.match((await sixth.json()).error, /You can start 5 topics a day\. You can start another one in about 24 hours\./);
});

test('replies and votes are not limited', async () => {
  const id = (await (await send('GET', '/api/topics?sort=new')).json()).topics[0].id;
  for (let n = 0; n < 7; n++) assert.equal((await send('POST', `/api/topics/${id}/replies`, { body: 'Reply ' + n }, tokens.ann)).status, 201);
  assert.equal((await send('POST', `/api/topics/${id}/vote`, {}, tokens.ann)).status, 200);
});

test('each person has their own 5', async () => {
  assert.equal((await newTopic('bob', 1)).status, 201);
});

test('deleting a topic does not make room for another', async () => {
  const mine = (await (await send('GET', '/api/topics?sort=new')).json()).topics.find((t) => t.author === 'ann');
  await send('POST', `/api/admin/topic/${mine.id}/state`, { state: 'deleted' }, tokens.owner);
  assert.equal((await newTopic('ann', 7)).status, 429);
});

test('a day later there is room again', async () => {
  db.prepare("UPDATE topics SET created_at = datetime('now', '-25 hours') WHERE user_id = ?").run(userId('ann@example.com'));
  assert.equal((await newTopic('ann', 8)).status, 201);
});

test('the owner has no limit', async () => {
  for (let n = 1; n <= 7; n++) assert.equal((await newTopic('owner', n)).status, 201, `owner topic ${n}`);
});

test('the owner can choose a different limit', async () => {
  const app = createApp({ dbFile: ':memory:', topicsPerDay: 2 });
  const s = await new Promise((resolve) => { const x = app.listen(0, () => resolve(x)); });
  const own = app.locals.db;
  const u = own.prepare('INSERT INTO users (email, name) VALUES (?, ?) RETURNING id').get('z@example.com', 'z');
  const token = 'tok' + 'z'.repeat(30);
  own.prepare('INSERT INTO sessions (token_hash, user_id, created_at) VALUES (?, ?, ?)').run(require('node:crypto').createHash('sha256').update(token).digest('hex'), u.id, Date.now());
  const post = () => fetch(`http://127.0.0.1:${s.address().port}/api/topics`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({ title: 'Some topic', label: 'bug', body: 'x' }),
  });
  const statuses = [(await post()).status, (await post()).status, (await post()).status];
  s.close();
  assert.deepEqual(statuses, [201, 201, 429]);
});
