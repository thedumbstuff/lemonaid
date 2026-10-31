const test = require('node:test');
const assert = require('node:assert');
const { createApp } = require('../src/app');

let server, base;
test.before(async () => {
  await new Promise((resolve) => {
    server = createApp().listen(0, resolve);
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
