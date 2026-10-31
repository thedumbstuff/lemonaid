// Checks the AI check through the REAL Anthropic library, talking to a pretend Anthropic
// server on this computer. It cannot prove Anthropic accepts the request (that needs a real
// key), but it proves what Lemonaid actually puts on the wire and that it reads the answer.
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const Anthropic = require('@anthropic-ai/sdk');
const { createAiCheck } = require('../src/ai');
const { openDb } = require('../src/db');

let fake, baseURL, seen, reply;
test.before(async () => {
  fake = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      seen = { method: req.method, url: req.url, headers: req.headers, body: raw ? JSON.parse(raw) : null };
      res.writeHead(reply.status || 200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(reply.json));
    });
  });
  await new Promise((resolve) => fake.listen(0, '127.0.0.1', resolve));
  baseURL = `http://127.0.0.1:${fake.address().port}`;
});
test.after(() => fake.close());

const message = (text, extra = {}) => ({
  json: {
    id: 'msg_test', type: 'message', role: 'assistant', model: 'claude-opus-5-5',
    content: [{ type: 'text', text }], stop_reason: 'end_turn', stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 5 }, ...extra,
  },
});
const makeCheck = () =>
  createAiCheck({ db: openDb(':memory:'), client: new Anthropic({ apiKey: 'sk-ant-test', baseURL, maxRetries: 0 }) });

test('the request sent to Anthropic has the right shape', async () => {
  reply = message('{"verdict":"publish","reason":"fine"}');
  const result = await makeCheck().check('A title', 'Some body');
  assert.deepEqual(result, { hold: false });
  assert.equal(seen.method, 'POST');
  assert.equal(seen.url, '/v1/messages');
  assert.equal(seen.headers.authorization, 'Bearer sk-ant-test'); // the library sends the key this way
  assert.ok(seen.headers['anthropic-version']);
  assert.equal(seen.body.model, 'claude-opus-5-5');
  assert.equal(seen.body.output_config.effort, 'low');
  assert.equal(seen.body.output_config.format.type, 'json_schema');
  assert.deepEqual(seen.body.output_config.format.schema.required, ['verdict', 'reason']);
  assert.equal(seen.body.output_config.format.schema.additionalProperties, false);
  assert.ok(seen.body.max_tokens >= 1000);
  assert.equal(seen.body.messages[0].role, 'user');
  assert.equal(seen.body.messages[0].content, '<post>\nA title\n\nSome body\n</post>');
  // settings that newer models refuse must not be sent
  for (const banned of ['temperature', 'top_p', 'top_k', 'tool_choice', 'budget_tokens']) {
    assert.ok(!(banned in seen.body), banned);
  }
  assert.ok(!('thinking' in seen.body) || seen.body.thinking.type !== 'disabled');
});

test('a "hold" answer is read, with its reason', async () => {
  reply = message('{"verdict":"hold","reason":"Personal attack"}');
  assert.deepEqual(await makeCheck().check('x'), { hold: true, reason: 'Personal attack' });
});

test('a refusal from Anthropic holds the post', async () => {
  reply = message('', { content: [], stop_reason: 'refusal', stop_details: { type: 'refusal', category: null, explanation: null } });
  assert.equal((await makeCheck().check('x')).hold, true);
});

test('an error from Anthropic (wrong key, busy, down) publishes the post and logs it', async () => {
  const original = console.error;
  const logged = [];
  console.error = (...a) => logged.push(a.join(' '));
  try {
    for (const status of [401, 429, 500]) {
      reply = { status, json: { type: 'error', error: { type: 'api_error', message: 'nope' } } };
      assert.deepEqual(await makeCheck().check('x'), { hold: false, failed: true }, String(status));
    }
  } finally {
    console.error = original;
  }
  assert.equal(logged.length, 3);
});
