const test = require('node:test');
const assert = require('node:assert');
const { createApp } = require('../src/app');

let server, base;
test.before(async () => {
  await new Promise((resolve) => { server = createApp({ dbFile: ':memory:' }).listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server.close());

test('the test mailbox never opens through a proxy, even if production mode was forgotten', async () => {
  assert.equal((await fetch(base + '/mailbox')).status, 200); // someone at this computer
  for (const header of ['x-forwarded-for', 'forwarded', 'x-real-ip']) {
    const res = await fetch(base + '/mailbox', { headers: { [header]: '203.0.113.9' } });
    assert.equal(res.status, 404, header);
  }
});

test('the test mailbox is off once a real email service is set up', async () => {
  const app = createApp({ dbFile: ':memory:', mailTransport: { sendMail: async () => {} } });
  const s = await new Promise((resolve) => { const x = app.listen(0, '127.0.0.1', () => resolve(x)); });
  const res = await fetch(`http://127.0.0.1:${s.address().port}/mailbox`);
  s.close();
  assert.equal(res.status, 404);
});

test('the board pages only run their own code', async () => {
  for (const p of ['/board/', '/board/board.js']) {
    const csp = (await fetch(base + p)).headers.get('content-security-policy');
    assert.match(csp, /script-src 'self'/, p);
    assert.match(csp, /object-src 'none'/, p);
    assert.match(csp, /frame-ancestors \*/, p); // any site may still show the board
  }
});

test('errors are short and plain, never the program insides', async () => {
  const bad = await fetch(base + '/api/topics', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{bad' });
  assert.equal(bad.status, 400);
  const text = await bad.text();
  assert.deepEqual(JSON.parse(text), { error: 'That request could not be read.' });
  assert.ok(!/\n\s+at |node_modules|SyntaxError|[A-Z]:\\/.test(text));

  const big = await fetch(base + '/api/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body: 'a'.repeat(200000) }) });
  assert.equal(big.status, 413);
  assert.deepEqual(await big.json(), { error: 'That is too big to send.' });

  const missing = await fetch(base + '/api/nope');
  assert.equal(missing.status, 404);
  assert.deepEqual(await missing.json(), { error: 'Not found.' });
});
