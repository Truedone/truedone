// MCP-01-AC01 (D38): npx truedone mcp answers by the Model Context Protocol over stdio. main(['mcp']) runs in-process with
// stdin from a list of lines; PR calls answer from test/fixtures/api, recorded GitHub responses. initialize, tools/list and
// tools/call: two tools with input schemas, the verdict as text (the --pr-line line) and as structured content, -32601 for an
// unknown method, no answer to a notification, every stdout line a protocol message, and a client closing stdout ends the
// session without a crash.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough, Readable } from 'node:stream';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { main } from '../src/cli.mjs';
import { VERSION } from '../src/version.mjs';

const API_DIR = fileURLToPath(new URL('./fixtures/api/', import.meta.url));
const recorded = JSON.parse(fs.readFileSync(API_DIR + 'index.json', 'utf8'));
const classify = (p) => (/\.test\.js$/.test(p) ? 'test' : p.startsWith('.github/workflows/') ? 'workflow' : 'source');
const RESULT = { schema: 'truedone.verdict/1', verdict: 'review', label: 'truedone:review', partial: false, reasons: [{ check: 'runner_config', file: '.github/workflows/ci.yml', message: 'the workflow changed' }], next: null };

function sink() { const s = { text: '', write: (x) => { s.text += x; return true; } }; return s; }
function recordedFetch() {
  const log = [];
  const fetch = async (url, init = {}) => {
    log.push({ url, method: init.method ?? 'GET' });
    const u = new URL(url);
    const table = u.host === 'api.github.com' ? recorded.api : u.host === 'raw.githubusercontent.com' ? recorded.raw : null;
    const hit = table?.[u.pathname + u.search];
    if (!hit) return new Response('{"message":"Not Found"}', { status: 404 });
    return new Response(fs.readFileSync(API_DIR + hit.file, 'utf8'), { status: hit.status });
  };
  return { fetch, log };
}
async function session(messages, { fetch = recordedFetch().fetch, cwd = os.tmpdir() } = {}) {
  const stdout = sink(), stderr = sink();
  const stdin = Readable.from(messages.map((m) => (typeof m === 'string' ? m : JSON.stringify(m)) + '\n'));
  const code = await main(['mcp'], { analyse: () => RESULT, classify, fetch, cwd, env: { PATH: process.env.PATH, HOME: os.tmpdir() }, stdin, stdout, stderr });
  const lines = stdout.text.split('\n').filter(Boolean);
  return { code, lines, msgs: lines.map((l) => JSON.parse(l)), err: stderr.text };
}
const init = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0' } } };
const initialized = { jsonrpc: '2.0', method: 'notifications/initialized' };

test('initialize names the server and its tools capability, and echoes a supported protocol version', async () => {
  const s = await session([init, initialized]);
  assert.equal(s.code, 0, s.err);
  assert.equal(s.msgs.length, 1, 'the initialized notification gets no answer');
  const r = s.msgs[0];
  assert.equal(r.jsonrpc, '2.0');
  assert.equal(r.id, 1);
  assert.equal(r.result.protocolVersion, '2025-06-18');
  assert.deepEqual(r.result.serverInfo, { name: 'truedone', version: VERSION });
  assert.ok(r.result.capabilities.tools, 'the tools capability');
  assert.ok(!JSON.stringify(r.result).includes('truedone_check_'), 'tool names come from tools/list only');
  const old = await session([{ ...init, params: { ...init.params, protocolVersion: '1999-01-01' } }]);
  assert.equal(old.msgs[0].result.protocolVersion, '2025-06-18', 'an unknown version gets the latest the server speaks');
});

test('tools/list gives two tools, each with a JSON input schema', async () => {
  const s = await session([init, initialized, { jsonrpc: '2.0', id: 2, method: 'tools/list' }]);
  const tools = s.msgs.find((m) => m.id === 2).result.tools;
  assert.deepEqual(tools.map((t) => t.name), ['truedone_check_pr', 'truedone_check_branch']);
  for (const t of tools) {
    assert.equal(t.inputSchema.type, 'object', t.name);
    assert.equal(typeof t.description, 'string');
  }
  assert.deepEqual(tools[0].inputSchema.required, ['url']);
  assert.equal(tools[0].inputSchema.properties.url.type, 'string');
  assert.equal(tools[1].inputSchema.properties.path.type, 'string');
});

test('tools/call truedone_check_pr returns the verdict line as text and the result as structured content, from GitHub reads only', async () => {
  const f = recordedFetch();
  const s = await session([init, initialized, { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'truedone_check_pr', arguments: { url: 'https://github.com/octo/demo/pull/12' } } }], { fetch: f.fetch });
  const r = s.msgs.find((m) => m.id === 3).result;
  assert.equal(r.isError, false);
  assert.deepEqual(r.content, [{ type: 'text', text: 'truedone: Test changes: review, tests or runner setup changed in a way to review. https://truedone.pages.dev/octo/demo/pull/12?via=pr-line' }]);
  assert.deepEqual(r.structuredContent, RESULT);
  assert.ok(f.log.length > 0);
  for (const c of f.log) {
    assert.equal(c.method, 'GET');
    assert.ok(['api.github.com', 'raw.githubusercontent.com'].includes(new URL(c.url).host), c.url);
  }
  const bad = await session([init, { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'truedone_check_pr', arguments: { url: 'not a link' } } }]);
  assert.equal(bad.msgs.find((m) => m.id === 4).result.isError, true);
});

test('an unknown method answers -32601, an unknown tool -32602, and a line that is not JSON -32700', async () => {
  const s = await session([init, { jsonrpc: '2.0', id: 5, method: 'resources/list' }, { jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'nope', arguments: {} } }, 'this is not json', { jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 9 } }]);
  assert.equal(s.msgs.find((m) => m.id === 5).error.code, -32601);
  assert.equal(s.msgs.find((m) => m.id === 6).error.code, -32602);
  assert.equal(s.msgs.find((m) => m.id === null).error.code, -32700);
  assert.equal(s.msgs.length, 4, 'the cancelled notification gets no answer');
});

test('stdout holds protocol messages only, one per line', async () => {
  const s = await session([init, initialized, { jsonrpc: '2.0', id: 2, method: 'tools/list' }, { jsonrpc: '2.0', id: 7, method: 'ping' }, { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'truedone_check_pr', arguments: { url: 'octo/demo#12' } } }]);
  assert.ok(s.lines.length >= 4);
  for (const l of s.lines) {
    const m = JSON.parse(l);
    assert.equal(m.jsonrpc, '2.0', l);
    assert.ok('result' in m || 'error' in m, l);
  }
  assert.deepEqual(s.msgs.find((m) => m.id === 7).result, {});
});

test('a client that closes its end of stdout ends the session: no crash, and nothing written after', async () => {
  const out = new EventEmitter();
  let writes = 0, firstWrite;
  const wrote = new Promise((r) => { firstWrite = r; });
  out.write = () => {
    writes += 1;
    process.nextTick(() => { out.emit('error', Object.assign(new Error('write EPIPE'), { code: 'EPIPE' })); firstWrite(); });
    return false;
  };
  const stdin = new PassThrough();
  const done = main(['mcp'], { analyse: () => RESULT, classify, fetch: recordedFetch().fetch, cwd: os.tmpdir(), env: { PATH: process.env.PATH, HOME: os.tmpdir() }, stdin, stdout: out, stderr: sink() });
  stdin.write(JSON.stringify(init) + '\n');
  await wrote;
  stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }) + '\n');
  stdin.end();
  assert.equal(await done, 0);
  assert.equal(writes, 1);
});
