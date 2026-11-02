const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadSettingsFile } = require('../src/settings');
const { createApp } = require('../src/app');

const quiet = { warn: () => {} };
const fileWith = (text) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lemonaid-settings-'));
  const file = path.join(dir, 'settings.json');
  fs.writeFileSync(file, text);
  return file;
};

test('SECRETS_FILE: its settings are used as if they were in the environment', () => {
  const env = { SECRETS_FILE: fileWith(JSON.stringify({ SMTP_URL: 'smtps://u:p@mail.example.com:465', TOPICS_PER_DAY: 3 })) };
  assert.deepEqual(loadSettingsFile(env, quiet).sort(), ['SMTP_URL', 'TOPICS_PER_DAY']);
  assert.equal(env.SMTP_URL, 'smtps://u:p@mail.example.com:465');
  assert.equal(env.TOPICS_PER_DAY, '3');
});

test('SECRETS_FILE: a setting already in the environment wins', () => {
  const env = { SMTP_URL: 'smtp://from-env', SECRETS_FILE: fileWith(JSON.stringify({ SMTP_URL: 'smtp://from-file' })) };
  assert.deepEqual(loadSettingsFile(env, quiet), []);
  assert.equal(env.SMTP_URL, 'smtp://from-env');
});

test('SECRETS_FILE: odd names and values are left out', () => {
  const env = { SECRETS_FILE: fileWith(JSON.stringify({ lower: 'x', 'BAD-NAME': 'x', NESTED: { a: 1 }, LIST: [1], OK_ONE: 'yes' })) };
  assert.deepEqual(loadSettingsFile(env, quiet), ['OK_ONE']);
  assert.equal(env.lower, undefined);
});

test('SECRETS_FILE: a missing file is a warning, not a crash', () => {
  const warned = [];
  const env = { SECRETS_FILE: path.join(os.tmpdir(), 'lemonaid-no-such-file.json') };
  assert.deepEqual(loadSettingsFile(env, { warn: (m) => warned.push(m) }), []);
  assert.match(warned[0], /could not be read/);
});

test('SECRETS_FILE: a broken file stops Lemonaid with a clear message', () => {
  assert.throws(() => loadSettingsFile({ SECRETS_FILE: fileWith('{not json') }, quiet), /not valid JSON/);
  assert.throws(() => loadSettingsFile({ SECRETS_FILE: fileWith('["a"]') }, quiet), /JSON object/);
});

test('no SECRETS_FILE: nothing happens', () => {
  assert.deepEqual(loadSettingsFile({}, quiet), []);
});

test('online, the board address opens the board, not the demo website', async () => {
  const server = await new Promise((resolve) => {
    const s = createApp({ dbFile: ':memory:', testMailbox: false, ownerEmail: 'owner@example.com' }).listen(0, () => resolve(s));
  });
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const home = await fetch(base + '/', { redirect: 'manual' });
    assert.equal(home.status, 302);
    assert.equal(home.headers.get('location'), '/board/');
    assert.equal((await fetch(base + '/index.html')).status, 404);
    assert.equal((await fetch(base + '/board/')).status, 200);
    assert.equal((await fetch(base + '/lemonaid.js')).status, 200);
  } finally {
    server.close();
  }
});
