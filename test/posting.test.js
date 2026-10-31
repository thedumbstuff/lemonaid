const test = require('node:test');
const assert = require('node:assert');
const { createApp } = require('../src/app');

let server, base, db, token;
test.before(async () => {
  const app = createApp({ dbFile: ':memory:' });
  db = app.locals.db;
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  // sign in as a visitor
  await send('POST', '/api/auth/request-code', { email: 'tom@example.com' });
  const mail = db.prepare('SELECT subject FROM mailbox ORDER BY id DESC').get();
  const code = /(\d{6})/.exec(mail.subject)[1];
  token = (await (await send('POST', '/api/auth/verify-code', { email: 'tom@example.com', code })).json()).token;
});
test.after(() => server.close());

const send = (method, url, body, auth) =>
  fetch(base + url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: 'Bearer ' + auth } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

test('you must be signed in to start a topic or reply', async () => {
  assert.equal((await send('POST', '/api/topics', { title: 'Hello', label: 'bug', body: 'x' })).status, 401);
  assert.equal((await send('POST', '/api/topics/1/replies', { body: 'x' })).status, 401);
});

test('a signed-in person can start a topic and it shows on the board', async () => {
  const res = await send('POST', '/api/topics', { title: '  Login   button is broken ', label: 'bug', body: 'It does **nothing**.' }, token);
  assert.equal(res.status, 201);
  const { id } = await res.json();
  const list = await (await send('GET', '/api/topics')).json();
  const topic = list.topics.find((t) => t.id === id);
  assert.equal(topic.title, 'Login button is broken');
  assert.equal(topic.label, 'bug');
  assert.equal(topic.status, 'open');
  assert.equal(topic.author, 'tom');
  const page = await (await send('GET', '/api/topics/' + id)).json();
  assert.match(page.topic.body_html, /<strong>nothing<\/strong>/);
});

test('a signed-in person can reply, and the reply count goes up', async () => {
  const { id } = await (await send('POST', '/api/topics', { title: 'Need help', label: 'question', body: 'How?' }, token)).json();
  assert.equal((await send('POST', `/api/topics/${id}/replies`, { body: 'Try `npm start`.' }, token)).status, 201);
  const page = await (await send('GET', '/api/topics/' + id)).json();
  assert.equal(page.replies.length, 1);
  assert.match(page.replies[0].body_html, /<code>npm start<\/code>/);
  const list = await (await send('GET', '/api/topics')).json();
  assert.equal(list.topics.find((t) => t.id === id).reply_count, 1);
});

test('a reply to a topic that does not exist is refused', async () => {
  assert.equal((await send('POST', '/api/topics/9999/replies', { body: 'hi' }, token)).status, 404);
});

test('bad topics are refused with a friendly message', async () => {
  const cases = [
    { title: 'ab', label: 'bug', body: 'x' },
    { title: 'x'.repeat(121), label: 'bug', body: 'x' },
    { title: 'Fine title', label: 'rant', body: 'x' },
    { title: 'Fine title', label: 'bug', body: '   ' },
    { title: 'Fine title', label: 'bug', body: 'x'.repeat(10001) },
    { title: 'Fine title', label: 'bug' },
  ];
  for (const c of cases) {
    const res = await send('POST', '/api/topics', c, token);
    assert.equal(res.status, 400, JSON.stringify(c).slice(0, 80));
    assert.ok((await res.json()).error);
  }
});

test('links and code blocks are shown nicely, and links open safely', async () => {
  const body = 'See https://example.com/docs\n\n```\nconst a = 1;\n```';
  const { id } = await (await send('POST', '/api/topics', { title: 'Code and link', label: 'idea', body }, token)).json();
  const { topic } = await (await send('GET', '/api/topics/' + id)).json();
  assert.match(topic.body_html, /<a href="https:\/\/example\.com\/docs"[^>]*rel="noopener noreferrer nofollow ugc"/);
  assert.match(topic.body_html, /<pre><code>const a = 1;/);
});

test('nobody can sneak harmful code into a post', async () => {
  const body = '<script>alert(1)</script> <img src=x onerror=alert(2)> [click](javascript:alert(3)) ![pic](http://x/y.png)';
  const { id } = await (await send('POST', '/api/topics', { title: 'Sneaky', label: 'idea', body }, token)).json();
  const { topic } = await (await send('GET', '/api/topics/' + id)).json();
  assert.ok(!topic.body_html.includes('<script'));
  assert.ok(!topic.body_html.includes('<img'));
  assert.ok(!/href="javascript:/i.test(topic.body_html));
  assert.match(topic.body_html, /&lt;script&gt;/);
});

test('the preview shows how text will look', async () => {
  const res = await send('POST', '/api/preview', { body: 'Hello `x`' });
  assert.match((await res.json()).html, /<code>x<\/code>/);
  assert.equal((await send('POST', '/api/preview', { body: 5 })).status, 400);
});
