// MCP-02-AC01 (PV-L01, PV-L02): the MCP server's two tools say in tools/list that they only read. Each tool carries a title
// and the protocol's annotations (ToolAnnotations): readOnlyHint true, destructiveHint false, idempotentHint true, and
// openWorldHint true, since both reach GitHub. truedone_check_pr reads the pull request from api.github.com and
// raw.githubusercontent.com (src/github.mjs loadPR), and truedone_check_branch, which otherwise reads the local repository
// only, reads the published action releases from api.github.com when the branch changes a workflow (src/cli.mjs
// staticVerdict, D18). annotations.title repeats the title, for a client on protocol 2025-03-26, where the annotation is the
// only title a tool has. main(['mcp']) is driven over stdio as mcp.test.mjs does, with GitHub answered from
// test/fixtures/api, and the published file is started with the argument mcp and must answer tools/list the same way.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { main } from '../src/cli.mjs';
import * as core from '../../core/core.mjs';

const API_DIR = fileURLToPath(new URL('./fixtures/api/', import.meta.url));
const recorded = JSON.parse(fs.readFileSync(API_DIR + 'index.json', 'utf8'));
const classify = (p) => (/\.test\.js$/.test(p) ? 'test' : p.startsWith('.github/workflows/') ? 'workflow' : 'source');
const RESULT = { schema: 'truedone.verdict/1', verdict: 'review', label: 'truedone:review', partial: false, reasons: [], next: null };
const TAGS = 'https://api.github.com/repos/Truedone/truedone-action/tags?per_page=100';

// what each tool does, as the code shows it: both only read, and both reach GitHub
const READS = { readOnlyHint: true, destructiveHint: false, idempotentHint: true };
const EXPECTED = {
  truedone_check_pr: { title: 'Check a pull request with truedone', openWorldHint: true },
  truedone_check_branch: { title: 'Check the current branch with truedone', openWorldHint: true },
};

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
function scratchDir(t, prefix) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  return d;
}
async function session(t, messages, { fetch = recordedFetch().fetch, cwd = os.tmpdir(), analyse = () => RESULT, classify: cls = classify } = {}) {
  const stdout = sink(), stderr = sink();
  const stdin = Readable.from(messages.map((m) => `${JSON.stringify(m)}\n`));
  const code = await main(['mcp'], { analyse, classify: cls, fetch, cwd, env: { PATH: process.env.PATH, HOME: scratchDir(t, 'truedone-mcp02-home-') }, stdin, stdout, stderr });
  assert.equal(code, 0, stderr.text);
  return stdout.text.split('\n').filter(Boolean).map((l) => JSON.parse(l));
}
const init = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'mcp02-test', version: '0' } } };
const initialized = { jsonrpc: '2.0', method: 'notifications/initialized' };
const list = { jsonrpc: '2.0', id: 2, method: 'tools/list' };
const listed = (msgs) => msgs.find((m) => m.id === 2).result.tools;
const call = (id, name, args) => ({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } });

function assertAnnotated(tools, where) {
  assert.deepEqual(tools.map((t) => t.name), Object.keys(EXPECTED), where);
  for (const t of tools) {
    const want = EXPECTED[t.name];
    assert.equal(t.title, want.title, `${where}: ${t.name} has its title`);
    assert.deepEqual(t.annotations, { title: want.title, ...READS, openWorldHint: want.openWorldHint }, `${where}: ${t.name} has annotations that say it only reads`);
  }
}

// a scratch repository: main holds the base and origin/HEAD names it; the branch work changes a source file and, with
// workflow, a workflow too. git runs with no global or system configuration and no maintenance.
function repo(t, { workflow }) {
  const top = scratchDir(t, 'truedone-mcp02-repo-');
  const env = { PATH: process.env.PATH, HOME: top, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'Dev One', GIT_AUTHOR_EMAIL: 'dev@example.com', GIT_COMMITTER_NAME: 'Dev One', GIT_COMMITTER_EMAIL: 'dev@example.com' };
  const d = path.join(top, 'repo');
  fs.mkdirSync(d);
  const git = (...a) => execFileSync('git', ['-c', 'maintenance.auto=false', '-c', 'gc.auto=0', ...a], { cwd: d, env, encoding: 'utf8' }).trim();
  const put = (f, body) => { fs.mkdirSync(path.join(d, path.dirname(f)), { recursive: true }); fs.writeFileSync(path.join(d, f), body); };
  git('init', '-q', '-b', 'main');
  put('src/add.js', 'export const add = (a, b) => a - b;\n');
  put('.github/workflows/ci.yml', 'on: push\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm test\n');
  git('add', '-A'); git('commit', '-qm', 'base');
  git('update-ref', 'refs/remotes/origin/main', 'main');
  git('symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main');
  git('checkout', '-qb', 'work');
  put('src/add.js', 'export const add = (a, b) => a + b;\n');
  if (workflow) put('.github/workflows/ci.yml', 'on: [push, pull_request]\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm test\n');
  git('add', '-A'); git('commit', '-qm', 'Fix add');
  put('src/more.js', 'export const one = 1;\n');
  // what a write would change: HEAD, every ref, the status, and every file in the working tree
  const files = () => fs.readdirSync(d, { recursive: true }).filter((f) => !f.split(path.sep).includes('.git')).sort()
    .map((f) => [f, fs.statSync(path.join(d, f)).isFile() ? fs.readFileSync(path.join(d, f), 'utf8') : null]);
  const state = () => ({ head: git('rev-parse', 'HEAD'), refs: git('for-each-ref'), status: git('status', '--porcelain=v1', '-uall'), files: files() });
  return { d, state };
}

test('tools/list gives each tool a title and annotations that say it only reads', async (t) => {
  assertAnnotated(listed(await session(t, [init, initialized, list])), 'main mcp');
  const old = await session(t, [{ ...init, params: { ...init.params, protocolVersion: '2025-03-26' } }, initialized, list]);
  assert.equal(old.find((m) => m.id === 1).result.protocolVersion, '2025-03-26');
  assertAnnotated(listed(old), 'main mcp on 2025-03-26');
});

test('each tool that says it reaches the open world reaches GitHub, with GET only', async (t) => {
  const tools = Object.fromEntries(listed(await session(t, [init, list])).map((x) => [x.name, x]));
  const pr = recordedFetch();
  const prAnswer = (await session(t, [init, call(3, 'truedone_check_pr', { url: 'https://github.com/octo/demo/pull/12' })], { fetch: pr.fetch })).find((m) => m.id === 3).result;
  assert.equal(prAnswer.isError, false, JSON.stringify(prAnswer));
  assert.equal(tools.truedone_check_pr.annotations?.openWorldHint, true, 'truedone_check_pr says it reaches the open world');
  assert.ok(pr.log.length > 0, 'truedone_check_pr read GitHub');
  for (const c of pr.log) {
    assert.equal(c.method, 'GET', c.url);
    assert.ok(['api.github.com', 'raw.githubusercontent.com'].includes(new URL(c.url).host), c.url);
  }
  // the branch tool reads GitHub's published action releases when the branch changes a workflow, and nothing otherwise
  const wf = repo(t, { workflow: true }), plain = repo(t, { workflow: false });
  const branch = recordedFetch(), quiet = recordedFetch();
  const wfAnswer = (await session(t, [init, call(4, 'truedone_check_branch', { path: wf.d })], { fetch: branch.fetch })).find((m) => m.id === 4).result;
  const plainAnswer = (await session(t, [init, call(5, 'truedone_check_branch', { path: plain.d })], { fetch: quiet.fetch })).find((m) => m.id === 5).result;
  assert.equal(wfAnswer.isError, false, JSON.stringify(wfAnswer));
  assert.equal(plainAnswer.isError, false, JSON.stringify(plainAnswer));
  assert.equal(tools.truedone_check_branch.annotations?.openWorldHint, true, 'truedone_check_branch says it reaches the open world');
  assert.deepEqual(branch.log, [{ url: TAGS, method: 'GET' }], 'truedone_check_branch read the published action releases');
  assert.deepEqual(quiet.log, [], 'with no workflow change, truedone_check_branch reads nothing from the network');
});

test('the branch tool leaves the repository as it found it, however often it runs', async (t) => {
  const tools = Object.fromEntries(listed(await session(t, [init, list])).map((x) => [x.name, x]));
  assert.equal(tools.truedone_check_branch.annotations?.readOnlyHint, true, 'truedone_check_branch says it only reads');
  assert.equal(tools.truedone_check_branch.annotations?.idempotentHint, true, 'truedone_check_branch says a repeat has no further effect');
  const r = repo(t, { workflow: true });
  const before = r.state();
  // core's own analyse and classify, so the answer is the real verdict of the branch, not a fixed one
  const msgs = await session(t, [init, call(6, 'truedone_check_branch', { path: r.d }), call(7, 'truedone_check_branch', { path: r.d })], { analyse: core.analyse, classify: core.classify });
  assert.equal(msgs.find((m) => m.id === 6).result.isError, false, JSON.stringify(msgs));
  assert.equal(msgs.find((m) => m.id === 6).result.structuredContent.schema, 'truedone.verdict/1');
  assert.deepEqual(msgs.find((m) => m.id === 7).result, msgs.find((m) => m.id === 6).result, 'the same call twice answers the same');
  assert.deepEqual(r.state(), before);
});

test('the published file, started with the argument mcp, lists the same annotated tools over stdio', (t) => {
  const pkg = JSON.parse(fs.readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'));
  const bin = fileURLToPath(new URL(`../${pkg.bin.truedone}`, import.meta.url));
  const r = spawnSync(process.execPath, [bin, 'mcp'], { input: [init, initialized, list].map((m) => `${JSON.stringify(m)}\n`).join(''), encoding: 'utf8', cwd: os.tmpdir(), env: { PATH: process.env.PATH, HOME: scratchDir(t, 'truedone-mcp02-home-') } });
  assert.equal(r.status, 0, r.stderr);
  const answers = r.stdout.split('\n').filter(Boolean).map((l) => JSON.parse(l));
  assertAnnotated(listed(answers), pkg.bin.truedone);
});
