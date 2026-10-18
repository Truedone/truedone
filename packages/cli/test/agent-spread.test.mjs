// AGENT-01-AC01 (D38, D39): the verdict travels with the agent's work. --pr-line prints one line with the verdict, its reason
// and the verdict's page; init writes four lines, the fourth asking for that line in the pull request; init --global writes them
// to the developer's own agent files under a scratch HOME, by init's rule; report prints the filled wrong-verdict form link and
// sends nothing. main() runs in-process; PR mode answers from test/fixtures/api, recorded GitHub responses.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { main } from '../src/cli.mjs';
import { init } from '../src/init.mjs';
import { VERSION } from '../src/constants.mjs';

const API_DIR = fileURLToPath(new URL('./fixtures/api/', import.meta.url));
const recorded = JSON.parse(fs.readFileSync(API_DIR + 'index.json', 'utf8'));
const LINES = fs.readFileSync(fileURLToPath(new URL('./fixtures/init/snippet.md', import.meta.url)), 'utf8').trimEnd().split('\n');
const PR_LINE_ASK = '- Put the line `npx truedone --pr-line` prints in the pull request description.';
const PKG = JSON.parse(fs.readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'));

const classify = (p) => (/\.test\.js$/.test(p) ? 'test' : p.startsWith('.github/workflows/') ? 'workflow' : 'source');
const verdict = (over = {}) => ({ schema: 'truedone.verdict/1', verdict: 'no_evidence', label: 'truedone:no-evidence', partial: false,
  reasons: [{ check: 'no_test', file: 'src/upload.js', message: 'source changed with no test' }, { check: 'claim', file: '', message: 'the text says tests were added' }, { check: 'no_test', file: 'src/b.js', message: 'source changed with no test' }],
  next: 'a test that fails without the change', ...over });

function sink() { const s = { text: '', write: (x) => { s.text += x; return true; } }; return s; }
function scratch(t, prefix) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  return d;
}
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
async function run(argv, { fetch, cwd = os.tmpdir(), env, result } = {}) {
  const stdout = sink(), stderr = sink();
  const code = await main(argv, { analyse: () => verdict(result), classify, fetch: fetch ?? (async (u) => { throw new Error(`no network expected: ${u}`); }), cwd,
    env: env ?? { PATH: process.env.PATH, HOME: os.tmpdir() }, stdout, stderr });
  return { code, out: stdout.text, err: stderr.text };
}

test('--pr-line on a pull request prints one line: the verdict, its reason and the pull request page', async () => {
  const f = recordedFetch();
  const r = await run(['octo/demo#12', '--pr-line'], { fetch: f.fetch });
  assert.equal(r.code, 0, r.err);
  assert.equal(r.out, 'truedone: No red-green evidence, source changed, and no test in the pull request fails without it. https://truedone.pages.dev/octo/demo/pull/12?via=pr-line\n');
  const p = await run(['https://github.com/octo/demo/pull/12', '--pr-line'], { fetch: recordedFetch().fetch, result: { verdict: 'tampered', label: 'truedone:tampered', partial: true } });
  assert.equal(p.out, 'truedone: Tampered (partial), a test that existed at base was disabled or weakened. https://truedone.pages.dev/octo/demo/pull/12?via=pr-line\n');
});

test('--pr-line on the current branch, before any pull request exists, links the why page', async (t) => {
  const d = scratch(t, 'truedone-prline-');
  const env = { PATH: process.env.PATH, HOME: d, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 'Dev', GIT_AUTHOR_EMAIL: 'dev@example.com', GIT_COMMITTER_NAME: 'Dev', GIT_COMMITTER_EMAIL: 'dev@example.com' };
  const sh = (...a) => execFileSync('git', a, { cwd: d, env, encoding: 'utf8' });
  sh('init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(d, 'a.js'), 'export const a = 1;\n');
  sh('add', '-A'); sh('commit', '-qm', 'base');
  sh('checkout', '-qb', 'feature');
  fs.writeFileSync(path.join(d, 'a.js'), 'export const a = 2;\n');
  const r = await run(['--pr-line'], { cwd: d, env, result: { verdict: 'unrun', label: 'truedone:unrun', reasons: [] } });
  assert.equal(r.code, 0, r.err);
  assert.equal(r.out, 'truedone: Tests changed: not run, tests changed cleanly and no red-green has run yet. https://truedone.pages.dev/why?via=pr-line\n');
});

test('--pr-line and --json together, or --global without init, are usage errors', async () => {
  assert.equal((await run(['octo/demo#12', '--pr-line', '--json'])).code, 2);
  assert.equal((await run(['--global'])).code, 2);
  assert.equal((await run(['init', '--pr-line'])).code, 2);
});

test('init writes four lines, the fourth asking for the --pr-line line in the pull request', (t) => {
  const d = scratch(t, 'truedone-init4-');
  init(d, { log: () => {} });
  const lines = fs.readFileSync(path.join(d, 'AGENTS.md'), 'utf8').trimEnd().split('\n');
  assert.deepEqual(lines, LINES);
  assert.equal(lines.length, 4);
  assert.equal(lines[3], PR_LINE_ASK);
});

test('init --global writes ~/.claude/CLAUDE.md, and ~/.codex/AGENTS.md only when ~/.codex exists, never editing or repeating lines', async (t) => {
  const home = scratch(t, 'truedone-home-');
  const env = { PATH: process.env.PATH, HOME: home };
  const first = await run(['init', '--global'], { env });
  assert.equal(first.code, 0, first.err);
  assert.equal(fs.readFileSync(path.join(home, '.claude/CLAUDE.md'), 'utf8'), LINES.join('\n') + '\n');
  assert.equal(fs.existsSync(path.join(home, '.codex')), false, 'no ~/.codex is created');
  assert.match(first.out, /~\/\.claude\/CLAUDE\.md: created 4 lines/);

  const codexBody = '# Codex\n\nUse pnpm.\n';
  fs.mkdirSync(path.join(home, '.codex'));
  fs.writeFileSync(path.join(home, '.codex/AGENTS.md'), codexBody);
  const claudeBefore = '# Me\n\nPrefer small diffs.\n' + LINES[0] + '\n';
  fs.writeFileSync(path.join(home, '.claude/CLAUDE.md'), claudeBefore);
  const second = await run(['init', '--global'], { env });
  assert.equal(second.code, 0, second.err);
  const claude = fs.readFileSync(path.join(home, '.claude/CLAUDE.md'), 'utf8');
  assert.ok(claude.startsWith(claudeBefore), 'the existing bytes are a prefix');
  assert.equal(claude.split('\n').filter((l) => l === LINES[0]).length, 1, 'a line already there is not repeated');
  assert.deepEqual(claude.slice(claudeBefore.length).split('\n').filter(Boolean), LINES.slice(1));
  const codex = fs.readFileSync(path.join(home, '.codex/AGENTS.md'), 'utf8');
  assert.ok(codex.startsWith(codexBody));
  assert.deepEqual(codex.slice(codexBody.length).split('\n').filter(Boolean), LINES);

  const third = await run(['init', '--global'], { env });
  assert.equal(fs.readFileSync(path.join(home, '.claude/CLAUDE.md'), 'utf8'), claude, 'a second run writes nothing');
  assert.equal(fs.readFileSync(path.join(home, '.codex/AGENTS.md'), 'utf8'), codex);
  assert.match(third.out, /already there; nothing written/);
});

test('report prints the wrong-verdict form link filled from the verdict, and makes no request but GitHub reads', async () => {
  const f = recordedFetch();
  const r = await run(['report', 'octo/demo#12'], { fetch: f.fetch });
  assert.equal(r.code, 0, r.err);
  const link = r.out.trim().split('\n').pop();
  const u = new URL(link);
  assert.equal(`${u.origin}${u.pathname}`, 'https://github.com/Truedone/truedone/issues/new');
  const q = Object.fromEntries(u.searchParams);
  assert.equal(q.template, 'wrong-verdict.yml');
  assert.equal(q.pr, 'https://github.com/octo/demo/pull/12');
  assert.equal(q.head, 'd'.repeat(40));
  assert.equal(q.base, 'a'.repeat(40));
  assert.equal(q.verdict, 'no_evidence');
  assert.equal(q.reasons, 'no_test,claim');
  assert.equal(q.version, VERSION);
  assert.equal(q.kind, undefined, 'what is wrong is the reporter\'s to say');
  assert.match(r.out, /nothing has been sent/);
  assert.ok(f.log.length > 0);
  for (const c of f.log) {
    assert.equal(c.method, 'GET', `only reads: ${c.url}`);
    assert.ok(['api.github.com', 'raw.githubusercontent.com'].includes(new URL(c.url).host), `only GitHub: ${c.url}`);
  }
  assert.equal((await run(['report'])).code, 2);
  assert.equal((await run(['report', 'octo/demo#12', '--json'])).code, 2);
});

test('the reported version is the package version', () => {
  assert.equal(VERSION, PKG.version);
});
