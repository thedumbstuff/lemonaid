const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createApp } = require('../src/app');

async function withApp(options, fn) {
  const app = createApp({ dbFile: ':memory:', ...options });
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  try {
    return await fn(`http://127.0.0.1:${server.address().port}`, app);
  } finally {
    server.close();
  }
}

test('the owner can set the board colour, and bad colours are ignored', async () => {
  await withApp({ accent: '#0a7e5a' }, async (base) => {
    assert.equal((await (await fetch(base + '/api/config')).json()).accent, '0a7e5a');
  });
  await withApp({ accent: '#0A8' }, async (base) => {
    assert.equal((await (await fetch(base + '/api/config')).json()).accent, '00aa88');
  });
  for (const bad of ['red', 'url(javascript:1)', '#12', '#1234567', '"><script>']) {
    await withApp({ accent: bad }, async (base) => {
      assert.equal((await (await fetch(base + '/api/config')).json()).accent, null, bad);
    });
  }
});

test('the data folder can be chosen', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lemonaid-data-'));
  try {
    const app = createApp({ dataDir: dir });
    app.locals.db.close();
    assert.ok(fs.existsSync(path.join(dir, 'lemonaid.db')));
    assert.ok(fs.existsSync(path.join(dir, 'images')));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// Runs public/lemonaid.js against a tiny pretend page and returns the frame it makes.
function runEmbed(scriptAttrs) {
  const frames = [];
  const listeners = {};
  const script = {
    src: 'https://board.example.com/lemonaid.js',
    getAttribute: (name) => scriptAttrs[name] ?? null,
    parentNode: { insertBefore: (el) => frames.push(el) },
  };
  const document = {
    currentScript: script,
    createElement: () => ({ style: {}, setAttribute() {}, contentWindow: { id: 'frame-window' } }),
  };
  const window = { addEventListener: (type, fn) => { listeners[type] = fn; } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'lemonaid.js'), 'utf8'), { document, window, URL });
  return { frame: frames[0], send: (e) => listeners.message(e) };
}

test('the one line adds the board, with the owner\'s colour when given', () => {
  assert.equal(runEmbed({}).frame.src, 'https://board.example.com/board/');
  assert.equal(runEmbed({ 'data-color': '#0a7e5a' }).frame.src, 'https://board.example.com/board/?color=0a7e5a');
  assert.equal(runEmbed({ 'data-color': '0A8' }).frame.src, 'https://board.example.com/board/?color=0A8');
  // junk in the colour is never passed on
  assert.equal(runEmbed({ 'data-color': '"><script>' }).frame.src, 'https://board.example.com/board/');
});

test('the frame grows to the board height, but only when the board itself says so', () => {
  const { frame, send } = runEmbed({});
  send({ source: frame.contentWindow, origin: 'https://board.example.com', data: { lemonaid: 'height', height: 900.2 } });
  assert.equal(frame.style.height, '901px');
  send({ source: { id: 'someone else' }, origin: 'https://board.example.com', data: { lemonaid: 'height', height: 5000 } });
  send({ source: frame.contentWindow, origin: 'https://evil.example', data: { lemonaid: 'height', height: 5000 } });
  send({ source: frame.contentWindow, origin: 'https://board.example.com', data: { lemonaid: 'height', height: 'tall' } });
  assert.equal(frame.style.height, '901px');
  send({ source: frame.contentWindow, origin: 'https://board.example.com', data: { lemonaid: 'height', height: 100 } });
  assert.equal(frame.style.height, '520px'); // never smaller than the minimum
});

test('the board is built to fit phones', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'board', 'board.css'), 'utf8');
  assert.match(css, /@media \(max-width: 560px\)/);
  assert.match(css, /font-size: 16px/); // stops phones zooming into boxes
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'board', 'index.html'), 'utf8');
  assert.match(html, /name="viewport" content="width=device-width, initial-scale=1"/);
});

test('responses say not to guess the file type', async () => {
  await withApp({}, async (base) => {
    assert.equal((await fetch(base + '/api/topics')).headers.get('x-content-type-options'), 'nosniff');
    assert.equal((await fetch(base + '/api/topics')).headers.get('x-powered-by'), null);
  });
});
