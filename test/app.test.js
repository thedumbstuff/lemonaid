const test = require('node:test');
const assert = require('node:assert');
const { createApp } = require('../src/app');

let server, base;
test.before(async () => {
  await new Promise((resolve) => {
    server = createApp({ dbFile: ':memory:' }).listen(0, resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server.close());

test('demo website opens and has the one line to copy', async () => {
  const res = await fetch(base + '/');
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /\/lemonaid\.js/);
  assert.match(html, /Copy the line/);
});

test('the one line (lemonaid.js) is served as JavaScript and adds the board', async () => {
  const res = await fetch(base + '/lemonaid.js');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /javascript/);
  assert.match(await res.text(), /\/board\//);
});

test('the board page opens and says Lemonaid', async () => {
  const res = await fetch(base + '/board/');
  assert.equal(res.status, 200);
  assert.match(await res.text(), /Lemonaid/);
});

test('the board page loads its script and style', async () => {
  for (const f of ['board.js', 'board.css']) {
    const res = await fetch(base + '/board/' + f);
    assert.equal(res.status, 200);
  }
});

test('the board lists the welcome topic', async () => {
  const data = await (await fetch(base + '/api/topics')).json();
  assert.equal(data.topics.length, 1);
  assert.equal(data.topics[0].title, 'Welcome to the board!');
  assert.equal(data.topics[0].reply_count, 1);
});

test('a topic opens with its reply', async () => {
  const list = await (await fetch(base + '/api/topics')).json();
  const data = await (await fetch(base + '/api/topics/' + list.topics[0].id)).json();
  assert.match(data.topic.body, /public space/);
  assert.equal(data.replies.length, 1);
});

test('a topic that does not exist says so', async () => {
  assert.equal((await fetch(base + '/api/topics/9999')).status, 404);
  assert.equal((await fetch(base + '/api/topics/abc')).status, 404);
});
