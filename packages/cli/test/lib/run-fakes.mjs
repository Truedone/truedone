// Shared pieces of the --run tests (CLI-03). core's analyse, judge and detect, and core/run's redGreen and
// restorePending, are stand-ins here: lane-c writes and tests them (RUN-01 to RUN-04, JUDGE-01). What runs for real is
// the CLI: its consent, its environment filter, its clone, its order of calls and its docker commands. Git is the real
// git, on repositories made in the test.
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { main } from '../../src/cli.mjs';

export const GITENV = { PATH: process.env.PATH, HOME: os.tmpdir(), GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'Dev One', GIT_AUTHOR_EMAIL: 'dev@example.com', GIT_COMMITTER_NAME: 'Dev One', GIT_COMMITTER_EMAIL: 'dev@example.com' };
export const RECORD = '.git/truedone-restore';

// TEST-01: git maintenance off, so no detached auto-maintenance writes into .git while the directory is removed (MAP-02)
export const sh = (cwd, ...a) => execFileSync('git', ['-c', 'maintenance.auto=false', '-c', 'gc.auto=0', ...a], { cwd, env: GITENV, encoding: 'utf8' }).trim();
export function write(dir, f, body) { fs.mkdirSync(path.join(dir, path.dirname(f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), body); }
export function tmp(t, prefix = 'truedone-run-', under = os.tmpdir()) {
  const d = fs.mkdtempSync(path.join(under, prefix));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  return d;
}

// a repository whose branch changes src/add.mjs and its test against main; under picks the parent directory
export function repo(t, under) {
  const d = tmp(t, 'truedone-run-', under);
  sh(d, 'init', '-q', '-b', 'main');
  write(d, 'src/add.mjs', 'export const add = (a, b) => a - b;\n');
  write(d, 'test/add.test.mjs', 'base test\n');
  sh(d, 'add', '-A'); sh(d, 'commit', '-qm', 'base');
  sh(d, 'checkout', '-qb', 'fix');
  write(d, 'src/add.mjs', 'export const add = (a, b) => a + b;\n');
  write(d, 'test/add.test.mjs', 'head test\n');
  sh(d, 'add', '-A'); sh(d, 'commit', '-qm', 'Fix add');
  return d;
}

// a repository standing in for github.com/octo/demo: main, and the PR's head under refs/pull/7/head as GitHub keeps it
export function remote(t) {
  const d = repo(t);
  const head = sh(d, 'rev-parse', 'fix');
  sh(d, 'checkout', '-q', 'main');
  sh(d, 'update-ref', 'refs/pull/7/head', head);
  sh(d, 'branch', '-qD', 'fix');
  return { d, url: `file://${d}`, head };
}

export function sink() { const s = { text: '', write: (x) => { s.text += x; return true; } }; return s; }
export function terminal(answer) {
  return { isTTY: true, read: false, async *[Symbol.asyncIterator]() { this.read = true; yield `${answer}\n`; } };
}
export const pipe = () => ({ isTTY: false, read: false, async *[Symbol.asyncIterator]() { this.read = true; } });

export const classify = (p) => (/\.test\.mjs$/.test(p) ? 'test' : 'source');
export const verdict = (over = {}) => ({ schema: 'truedone.verdict/1', verdict: 'unrun', label: 'truedone:unrun', partial: false, reasons: [], next: '', ...over });
export const report = (over = {}) => ({ schema: 'truedone.report/1', head_sha: 'h', checked_out_sha: 'h', base_sha: 'b', truedone_version: '0.1.0', runner: 'node-test', job: 'local',
  tests: [{ file: 'test/add.test.mjs', name: 'add sums', base: ['fail:assertion', 'fail:assertion'], head: ['pass', 'pass', 'pass'], condition: 'lines', asserts_new_symbol: false, duration_ms: 3 }],
  could_not_run: null, truncated: false, ...over });

const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
// RUN-02's record and restore, as S1 states them: head bytes and sha256 of each swapped file, then restore and check
export function swapLikeRun02(root, files) {
  const rec = {};
  for (const [f, baseBody] of Object.entries(files)) {
    const head = fs.readFileSync(path.join(root, f));
    rec[f] = { head: head.toString('base64'), sha256: sha(head) };
  }
  fs.writeFileSync(path.join(root, RECORD), JSON.stringify(rec));
  for (const [f, baseBody] of Object.entries(files)) fs.writeFileSync(path.join(root, f), baseBody);
}
export async function restoreLikeRun02(root) {
  const p = path.join(root, RECORD);
  if (!fs.existsSync(p)) return false;
  for (const [f, { head, sha256 }] of Object.entries(JSON.parse(fs.readFileSync(p, 'utf8')))) {
    const b = Buffer.from(head, 'base64');
    if (sha(b) !== sha256) throw new Error(`record of ${f} does not match its hash`);
    fs.writeFileSync(path.join(root, f), b);
  }
  fs.rmSync(p);
  return true;
}

// main with every --run dependency as a stand-in; calls[] records what ran, in order
export async function run(argv, over = {}) {
  const stdout = sink(), stderr = sink(), calls = [];
  const deps = {
    analyse: (i) => { calls.push(['analyse', i]); return verdict(); },
    classify,
    judge: (s, reports) => { calls.push(['judge', reports]); return verdict({ verdict: reports.length ? 'proven' : s.verdict }); },
    detect: (root, paths) => { calls.push(['detect', root, paths]); return paths.map((p) => ({ test: p, runner: 'node-test', cwd: '.', file: p, command: 'node --test {files}', reporter: 'junit' })); },
    redGreen: async (o) => { calls.push(['redGreen', o]); return report(); },
    restorePending: async (root) => { calls.push(['restorePending', root]); return restoreLikeRun02(root); },
    fetch: async (url) => {
      calls.push(['fetch', url]);
      if (url === 'https://api.github.com/repos/octo/demo/pulls/7') return new Response(JSON.stringify({ number: 7, base: { ref: 'main', sha: 'x' }, head: { sha: 'y' } }), { status: 200 });
      return new Response('{"message":"Not Found"}', { status: 404 });
    },
    cwd: os.tmpdir(), env: GITENV, stdin: pipe(), stdout, stderr,
    dockerOnPath: () => false,
    ...over,
  };
  const code = await main(argv, deps);
  return { code, out: stdout.text, err: stderr.text, calls, names: calls.map((c) => c[0]) };
}
