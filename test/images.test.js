const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApp } = require('../src/app');

let server, base, db, token, dir;
// The smallest real 1x1 PNG picture.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

test.before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lemonaid-img-'));
  const app = createApp({ topicsPerDay: 1000, dbFile: ':memory:', imagesDir: dir });
  db = app.locals.db;
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  await api('POST', '/api/auth/request-code', { email: 'pic@example.com' });
  const code = /(\d{6})/.exec(db.prepare('SELECT subject FROM mailbox ORDER BY id DESC').get().subject)[1];
  token = (await (await api('POST', '/api/auth/verify-code', { email: 'pic@example.com', code })).json()).token;
});
test.after(() => { server.close(); fs.rmSync(dir, { recursive: true, force: true }); });

const api = (method, url, body, auth) =>
  fetch(base + url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: 'Bearer ' + auth } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const upload = (buf, auth = token, type = 'image/png') =>
  fetch(base + '/api/images', {
    method: 'POST',
    headers: { 'Content-Type': type, ...(auth ? { Authorization: 'Bearer ' + auth } : {}) },
    body: buf,
  });

test('you must be signed in to add a picture', async () => {
  assert.equal((await upload(PNG, null)).status, 401);
});

test('a pasted picture is saved and can be opened', async () => {
  const res = await upload(PNG);
  assert.equal(res.status, 201);
  const { url } = await res.json();
  assert.match(url, /^\/uploads\/[a-f0-9]{32}\.png$/);
  const got = await fetch(base + url);
  assert.equal(got.status, 200);
  assert.equal(got.headers.get('content-type'), 'image/png');
  assert.equal(got.headers.get('x-content-type-options'), 'nosniff');
  assert.deepEqual(Buffer.from(await got.arrayBuffer()), PNG);
});

test('things that are not pictures are refused, whatever they claim to be', async () => {
  assert.equal((await upload(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), token, 'image/png')).status, 400);
  assert.equal((await upload(Buffer.from('<?php echo 1; ?> padding padding'), token, 'image/jpeg')).status, 400);
  assert.equal((await upload(Buffer.alloc(0))).status, 400);
});

test('a picture over 5 MB is refused with a friendly message', async () => {
  const big = Buffer.concat([PNG, Buffer.alloc(5 * 1024 * 1024)]);
  const res = await upload(big);
  assert.equal(res.status, 413);
  assert.match((await res.json()).error, /5 MB/);
});

test('only our own picture names can be opened', async () => {
  assert.equal((await fetch(base + '/uploads/..%2Fapp.js')).status, 404);
  assert.equal((await fetch(base + '/uploads/' + 'a'.repeat(32) + '.png')).status, 404);
  assert.equal((await fetch(base + '/uploads/evil.svg')).status, 404);
});

test('a saved picture shows in a topic, but outside pictures do not', async () => {
  const { url } = await (await upload(PNG)).json();
  const body = `Look: ![screenshot](${url})\n\n![tracker](http://evil.example/t.png)`;
  const { id } = await (await api('POST', '/api/topics', { title: 'With picture', label: 'bug', body }, token)).json();
  const { topic } = await (await api('GET', '/api/topics/' + id)).json();
  assert.ok(topic.body_html.includes(`<img src="${url}" alt="screenshot" loading="lazy">`));
  assert.ok(!topic.body_html.includes('evil.example'));
  assert.equal((topic.body_html.match(/<img/g) || []).length, 1);
});
