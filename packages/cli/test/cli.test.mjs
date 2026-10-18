// CLI-01-AC01 (PV-L02): npx truedone's commands, --json and exit codes on fixture repositories. main() runs in-process
// with stand-ins for core's analyse and classify (core.mjs is checked on its own); git is the real git, on
// repositories made here. PR mode answers from test/fixtures/api, recorded GitHub responses.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { main } from '../src/cli.mjs';

const API_DIR = fileURLToPath(new URL('./fixtures/api/', import.meta.url));
const recorded = JSON.parse(fs.readFileSync(API_DIR + 'index.json', 'utf8'));
const ENV = { PATH: process.env.PATH, HOME: os.tmpdir(), GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'Dev One', GIT_AUTHOR_EMAIL: 'dev@example.com', GIT_COMMITTER_NAME: 'Dev One', GIT_COMMITTER_EMAIL: 'dev@example.com' };
const VERDICT_IDS = ['tampered', 'review', 'could_not_run', 'proven', 'proven_new', 'proven_weak', 'no_evidence', 'pending', 'unrun', 'not_applicable'];

const classify = (p) => (/\.test\.js$/.test(p) ? 'test' : p.startsWith('.github/workflows/') ? 'workflow' : /^jest\.config\./.test(p) ? 'runner_config' : 'source');
const verdict = (over = {}) => ({ schema: 'truedone.verdict/1', verdict: 'unrun', label: 'truedone:unrun', partial: false, reasons: [], next: 'a red-green run of the changed tests', ...over });

function sink() { const s = { text: '', write: (x) => { s.text += x; return true; } }; return s; }
function noFetch() { return async (url) => { throw new Error(`no network expected: ${url}`); }; }
function recordedFetch() {
  const log = [];
  const fetch = async (url, init = {}) => {
    log.push({ url, headers: { ...(init.headers ?? {}) } });
    const u = new URL(url);
    const table = u.host === 'api.github.com' ? recorded.api : u.host === 'raw.githubusercontent.com' ? recorded.raw : null;
    const hit = table?.[u.pathname + u.search];
    if (!hit) return new Response('{"message":"Not Found"}', { status: 404 });
    return new Response(fs.readFileSync(API_DIR + hit.file, 'utf8'), { status: hit.status });
  };
  return { fetch, log, hosts: (h) => log.filter((r) => new URL(r.url).host === h) };
}
async function run(argv, over = {}) {
  const stdout = sink(), stderr = sink();
  let input;
  const analyse = over.analyse ?? ((i) => { input = i; return verdict(over.result); });
  const code = await main(argv, { analyse, classify, fetch: over.fetch ?? noFetch(), cwd: over.cwd ?? os.tmpdir(), env: over.env ?? ENV, stdout, stderr, ...(over.git ? { git: over.git } : {}) });
  return { code, out: stdout.text, err: stderr.text, input: () => input };
}

const sh = (cwd, ...a) => execFileSync('git', a, { cwd, env: ENV, encoding: 'utf8' }).trim();
function write(dir, f, body) { fs.mkdirSync(path.join(dir, path.dirname(f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), body); }
// main has a, b, c.test.js and a workflow; the branch changes them; main moves on after the branch point
function repo(t, { defaultBranch = 'main' } = {}) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'truedone-cli-'));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  sh(d, 'init', '-q', '-b', defaultBranch);
  write(d, 'src/a.js', 'export const a = 1;\n');
  write(d, 'src/b.js', 'export const b = 2;\n');
  write(d, 'src/old-name.js', 'export const moved = 3;\nexport const kept = 4;\nexport const more = 5;\n');
  write(d, 'test/c.test.js', 'export const base = "base of c";\n');
  write(d, '.github/workflows/ci.yml', 'name: ci\n');
  sh(d, 'add', '-A'); sh(d, 'commit', '-qm', 'base');
  const base = sh(d, 'rev-parse', 'HEAD');
  sh(d, 'checkout', '-qb', 'feature');
  write(d, 'src/a.js', 'export const a = 10;\n');
  fs.rmSync(path.join(d, 'src/b.js'));
  sh(d, 'mv', 'src/old-name.js', 'src/new-name.js');
  write(d, 'src/added.js', 'export const added = 1;\n');
  sh(d, 'add', '-A'); sh(d, 'commit', '-qm', 'Retry the upload');
  sh(d, 'checkout', '-q', defaultBranch);
  write(d, 'src/later.js', 'export const later = 1;\n');
  sh(d, 'add', '-A'); sh(d, 'commit', '-qm', 'later on main');
  sh(d, 'checkout', '-q', 'feature');
  write(d, 'test/c.test.js', 'export const head = "working tree of c";\n');   // uncommitted edit
  write(d, 'src/untracked.js', 'export const u = 1;\nexport const v = 2;\n');   // untracked
  return { d, base };
}

test('local mode: the branch and working tree against the merge-base, with every status', async (t) => {
  const { d } = repo(t);
  const r = await run([], { cwd: d });
  assert.equal(r.code, 0, r.err);
  const files = Object.fromEntries(r.input().files.map((f) => [f.path, f]));
  for (const p of ['src/a.js', 'src/b.js', 'src/added.js', 'src/new-name.js', 'src/untracked.js', 'test/c.test.js']) assert.ok(files[p], `listed: ${p}`);
  assert.equal(files['src/a.js'].status, 'modified');
  assert.equal(files['src/b.js'].status, 'removed');
  assert.equal(files['src/added.js'].status, 'added');
  assert.deepEqual([files['src/new-name.js'].status, files['src/new-name.js'].previous_path], ['renamed', 'src/old-name.js']);
  assert.equal(files['src/untracked.js'].status, 'added');
  assert.equal(files['test/c.test.js'].status, 'modified');
  assert.equal(files['src/later.js'], undefined, 'a commit on main after the branch point is not in the change');
  assert.equal(files['src/old-name.js'], undefined);
});

test('local mode: contents only for test, setup, config and workflow files, base from the merge-base and head from the working tree', async (t) => {
  const { d } = repo(t);
  const r = await run([], { cwd: d });
  const files = Object.fromEntries(r.input().files.map((f) => [f.path, f]));
  for (const p of ['src/a.js', 'src/b.js', 'src/added.js', 'src/new-name.js', 'src/untracked.js', 'test/c.test.js']) assert.ok(files[p], `listed: ${p}`);
  assert.equal(files['test/c.test.js'].base, 'export const base = "base of c";\n');
  assert.equal(files['test/c.test.js'].head, 'export const head = "working tree of c";\n');
  for (const p of ['src/a.js', 'src/added.js', 'src/untracked.js', 'src/new-name.js', 'src/b.js']) {
    assert.equal(files[p].base, undefined, p);
    assert.equal(files[p].head, undefined, p);
  }
});

test('local mode: patches have the PR files API shape, an untracked file included', async (t) => {
  const { d } = repo(t);
  const r = await run([], { cwd: d });
  const files = Object.fromEntries(r.input().files.map((f) => [f.path, f]));
  for (const p of ['src/a.js', 'src/b.js', 'src/added.js', 'src/new-name.js', 'src/untracked.js', 'test/c.test.js']) assert.ok(files[p], `listed: ${p}`);
  assert.match(files['src/a.js'].patch, /^@@ -1 \+1 @@\n-export const a = 1;\n\+export const a = 10;$/);
  assert.equal(files['src/untracked.js'].patch, '@@ -0,0 +1,2 @@\n+export const u = 1;\n+export const v = 2;');
  assert.equal(files['src/b.js'].patch, '@@ -1 +0,0 @@\n-export const b = 2;');
  assert.ok(!('patch' in files['src/new-name.js']) || !files['src/new-name.js'].patch.includes('diff --git'));
});

test('local mode: the title is the last commit subject and the author is the git user', async (t) => {
  const { d } = repo(t);
  sh(d, 'config', 'user.name', 'Dev One');
  const r = await run([], { cwd: d });
  assert.deepEqual(r.input().pr, { title: 'Retry the upload', body: '', author: { login: 'Dev One', type: 'User' } });
});

test('local mode: with no main branch, master is the default branch', async (t) => {
  const { d } = repo(t, { defaultBranch: 'master' });
  const r = await run([], { cwd: d });
  assert.equal(r.code, 0, r.err);
  assert.equal(r.input().files.some((f) => f.path === 'src/later.js'), false);
  assert.ok(r.input().files.some((f) => f.path === 'src/added.js'));
});

test('local mode: origin/HEAD names the default branch when it is set', async (t) => {
  const { d } = repo(t);
  const remote = fs.mkdtempSync(path.join(os.tmpdir(), 'truedone-cli-remote-'));
  t.after(() => fs.rmSync(remote, { recursive: true, force: true }));
  sh(remote, 'init', '-q', '--bare');
  sh(d, 'remote', 'add', 'origin', remote);
  sh(d, 'push', '-q', 'origin', 'main:trunk');
  sh(d, 'fetch', '-q', 'origin');
  sh(d, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/trunk');
  sh(d, 'branch', '-q', '-D', 'main');
  const r = await run([], { cwd: d });
  assert.equal(r.code, 0, r.err);
  assert.equal(r.input().files.some((f) => f.path === 'src/later.js'), false, 'the merge-base with origin/trunk');
});

test('--json prints the verdict object analyse returned, on one line', async (t) => {
  const { d } = repo(t);
  const result = { verdict: 'no_evidence', label: 'truedone:no-evidence', reasons: [{ check: 'source_no_test', file: 'src/a.js', message: 'source changed and no test fails without it' }] };
  const r = await run(['--json'], { cwd: d, result });
  assert.equal(r.code, 0);
  assert.equal(r.out.endsWith('\n'), true);
  assert.equal(r.out.trimEnd().split('\n').length, 1);
  assert.deepEqual(JSON.parse(r.out), verdict(result));
});

test('the readable output names the verdict, the reasons up to ten, what would change it and the next rung', async (t) => {
  const { d } = repo(t);
  const reasons = Array.from({ length: 12 }, (_, i) => ({ check: 'c', file: `src/f${i}.js`, line: i + 1, message: `reason ${i}` }));
  const r = await run([], { cwd: d, result: { verdict: 'no_evidence', label: 'truedone:no-evidence', reasons, next: 'a test that fails without the change' } });
  assert.match(r.out, /No red-green evidence/);
  assert.match(r.out, /src\/f0\.js:1: reason 0/);
  assert.match(r.out, /src\/f9\.js:10: reason 9/);
  assert.doesNotMatch(r.out, /reason 10/);
  assert.match(r.out, /2 more/);
  assert.match(r.out, /What would change the verdict: a test that fails without the change/);
  assert.match(r.out, /Claude Code plugin/);
  assert.match(r.out, /--run/);
  assert.match(r.out, /executes that PR's code/);
  assert.doesNotMatch(r.out, /\bsafe\b|\bcorrect\b/i);
});

test('exit 0 when a verdict is produced, for every verdict, with no --fail-on', async (t) => {
  const { d } = repo(t);
  for (const v of VERDICT_IDS) assert.equal((await run([], { cwd: d, result: { verdict: v } })).code, 0, v);
});

test('--fail-on exits 1 when the verdict is in the list and 0 when it is not', async (t) => {
  const { d } = repo(t);
  assert.equal((await run(['--fail-on', 'tampered,review'], { cwd: d, result: { verdict: 'review' } })).code, 1);
  assert.equal((await run(['--fail-on=tampered'], { cwd: d, result: { verdict: 'tampered' } })).code, 1);
  assert.equal((await run(['--fail-on', 'tampered,review'], { cwd: d, result: { verdict: 'unrun' } })).code, 0);
});

test('usage errors exit 2 and say what was wrong', async () => {
  for (const [argv, why] of [
    [['--nope'], /--nope/],
    [['--fail-on', 'tampered,bogus'], /bogus/],
    [['--fail-on'], /--fail-on/],
    [['octo/demo#1', 'octo/demo#2'], /one target/],
    [['not a target'], /not a target/],
    [['https://truedone.dev/octo/demo/pull/12'], /truedone\.dev\/octo\/demo\/pull\/12 is not a PR link/],
    [['--run'], /--run/],
    [['--docker'], /--docker/],
    [['init', 'extra'], /init/],
  ]) {
    const r = await run(argv);
    assert.equal(r.code, 2, argv.join(' '));
    assert.match(r.err, why, argv.join(' '));
  }
});

test('--help and -h print the usage on stdout and exit 0, whatever else is given (issue #72)', async () => {
  for (const argv of [['--help'], ['-h'], ['--help', '--nope'], ['octo/demo#1', '-h'], ['init', '--help']]) {
    const r = await run(argv, { git: () => { throw new Error('no git expected'); } });
    assert.equal(r.code, 0, argv.join(' '));
    assert.match(r.out, /^usage: npx truedone /, argv.join(' '));
    assert.equal(r.err, '', argv.join(' '));
  }
});

test('outside a git repository the local mode is a usage error', async (t) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'truedone-cli-nogit-'));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  const r = await run([], { cwd: d });
  assert.equal(r.code, 2);
  assert.match(r.err, /git/);
});

test('an internal error exits 3 with one line on stderr', async (t) => {
  const { d } = repo(t);
  const thrown = await run([], { cwd: d, analyse: () => { throw new Error('boom'); } });
  assert.equal(thrown.code, 3);
  assert.equal(thrown.err.trimEnd().split('\n').length, 1);
  assert.match(thrown.err, /boom/);
  const bad = await run([], { cwd: d, analyse: () => ({ verdict: 'unrun' }) });
  assert.equal(bad.code, 3, 'a result without schema truedone.verdict/1 is an internal error');
});

test('PR mode reads the PR through the API and starts no process', async () => {
  const f = recordedFetch();
  const git = () => { throw new Error('PR mode ran git'); };
  for (const target of ['octo/demo#12', 'https://github.com/octo/demo/pull/12', 'https://truedone.pages.dev/octo/demo/pull/12']) {
    f.log.length = 0;
    let input;
    const r = await run([target, '--json'], { fetch: f.fetch, git, analyse: (i) => { input = i; return verdict(); } });
    assert.equal(r.code, 0, r.err);
    assert.deepEqual(input.files.map((x) => x.path), ['src/upload.js', 'test/upload.test.js', '.github/workflows/ci.yml']);
    assert.equal(input.files[1].base, 'base of test/upload.test.js\n');
    assert.equal(input.files[1].head, 'head of test/upload.test.js\n');
    assert.equal(input.files[0].head, undefined);
    assert.deepEqual(input.pr.author, { login: 'helper-agent[bot]', type: 'Bot' });
  }
});

test('PR mode sends GITHUB_TOKEN to api.github.com only', async () => {
  const f = recordedFetch();
  const r = await run(['octo/demo#12'], { fetch: f.fetch, env: { ...ENV, GITHUB_TOKEN: 'ghp_example' } });
  assert.equal(r.code, 0, r.err);
  assert.ok(f.hosts('api.github.com').length >= 2);
  for (const x of f.hosts('api.github.com')) assert.equal(x.headers.authorization, 'Bearer ghp_example');
  for (const x of f.hosts('raw.githubusercontent.com')) assert.equal(x.headers.authorization, undefined);
});

test('a changed workflow brings the published Truedone/truedone-action SHAs into releases; with no workflow change they are not read', async (t) => {
  const f = recordedFetch();
  let input;
  await run(['octo/demo#12'], { fetch: f.fetch, analyse: (i) => { input = i; return verdict(); } });
  assert.deepEqual(input.releases, ['e'.repeat(40), 'f'.repeat(40)]);
  const { d } = repo(t);
  fs.writeFileSync(path.join(d, '.github/workflows/ci.yml'), 'name: ci\n');   // no workflow change on the branch
  const r = await run([], { cwd: d, fetch: noFetch() });
  assert.equal(r.code, 0, r.err);
  assert.equal(r.input().releases, undefined);
});

test('PR mode: a missing PR is a usage error and a rate limit is named with GITHUB_TOKEN', async () => {
  const missing = await run(['octo/demo#999'], { fetch: recordedFetch().fetch });
  assert.equal(missing.code, 2);
  assert.match(missing.err, /octo\/demo#999/);
  const limited = await run(['octo/demo#12'], { fetch: async () => new Response('{}', { status: 403, headers: { 'x-ratelimit-remaining': '0' } }) });
  assert.equal(limited.code, 3);
  assert.match(limited.err, /GITHUB_TOKEN/);
});

test('init writes the snippet in the working directory and exits 0', async (t) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'truedone-cli-init-'));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  const r = await run(['init'], { cwd: d });
  assert.equal(r.code, 0, r.err);
  assert.ok(fs.readFileSync(path.join(d, 'AGENTS.md'), 'utf8').includes('npx truedone'));   // CLI-02's snippet text until v2c
  assert.match(r.out, /AGENTS\.md/);
});
