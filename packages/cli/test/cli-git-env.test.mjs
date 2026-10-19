// CLI-10 (PV-L03, PV-L05, PV-L06): the command line's git gets the same credential-free environment as the plugin's
// (PLG-12). The first two cases run the bundled packages/cli/truedone.mjs as a child process in a scratch repository,
// npx truedone and --run, with a git wrapper first on PATH that records the environment of each call and then runs the
// real git, and with GITHUB_TOKEN, GH_TOKEN, AWS_SECRET_ACCESS_KEY and NPM_TOKEN in the child's environment. git must
// see none of them, nor any other name off PLG-12's list. The verdict must be the one the command line gives when git
// sees the whole environment: main runs in-process with the real core and a makeGit handed that environment, the way
// the command line ran git before, and through the same wrapper, which then records the tokens. The tests --run starts
// keep the session's environment (the owner's choice). The third case runs main in-process with --run's stand-ins on
// someone else's pull request, and holds that the git that clones it keeps S4's filtered environment. The child's
// environment is built here, not copied from this process, so the test runner's NODE_TEST_CONTEXT never reaches the
// red-green runs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { main } from '../src/cli.mjs';
import { makeGit } from '../src/local.mjs';
import { filterEnv } from '../src/run.mjs';
import { analyse, classify, judge } from '../../core/core.mjs';
import { detect } from '../../core/run/detect.mjs';
import { redGreen } from '../../core/run/run.mjs';
import { restorePending } from '../../core/run/swap.mjs';
import { run as runWithStandIns, remote, tmp, pipe, sink, GITENV } from './lib/run-fakes.mjs';

const CLI = fileURLToPath(new URL('../truedone.mjs', import.meta.url));
// the names PLG-12 lists; SYSTEMROOT, COMSPEC and PATHEXT are for Windows
const LISTED = ['PATH', 'HOME', 'USER', 'LOGNAME', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TMPDIR', 'TZ', 'XDG_CONFIG_HOME',
  'GIT_CONFIG_GLOBAL', 'GIT_CONFIG_NOSYSTEM', 'GIT_CEILING_DIRECTORIES', 'SYSTEMROOT', 'COMSPEC', 'PATHEXT'];
const TOKENS = { GITHUB_TOKEN: 'cli10-github-token', GH_TOKEN: 'cli10-gh-token', AWS_SECRET_ACCESS_KEY: 'cli10-aws-secret', NPM_TOKEN: 'cli10-npm-token' };
const USER_NAME = 'Scratch Global User';
// the subcommands localInput runs
const LOCAL_INPUT = ['rev-parse', 'symbolic-ref', 'merge-base', 'diff', 'ls-files', 'show', 'log', 'config'];

const SRC_BASE = 'export const add = (a, b) => a - b;\n';
const SRC_HEAD = 'export const add = (a, b) => a + b;\n';
const TEST_BASE = "import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { add } from '../src/add.mjs';\n\ntest('add is a function', () => assert.equal(typeof add, 'function'));\n";
// on head the test also writes the names of its environment to the file CLI10_TESTS_SAW names, once per run
const TEST_HEAD = `import fs from 'node:fs';\n${TEST_BASE}test('add sums', () => assert.equal(add(2, 3), 5));\n`
  + "if (process.env.CLI10_TESTS_SAW) fs.appendFileSync(process.env.CLI10_TESTS_SAW, JSON.stringify(Object.keys(process.env)) + '\\n');\n";

function realGit() {
  for (const dir of (process.env.PATH ?? '').split(path.delimiter).filter(Boolean)) {
    const p = path.join(dir, 'git');
    try { fs.accessSync(p, fs.constants.X_OK); if (fs.statSync(p).isFile()) return p; } catch { /* not here */ }
  }
  throw new Error('no git on PATH');
}

// a git first on PATH that appends { args, env, status } for each call to a dump file, then exits as the real git did;
// node is named by its absolute path, so the wrapper needs no PATH of its own
function wrapper(top) {
  const bin = path.join(top, 'bin');
  fs.mkdirSync(bin);
  const dump = path.join(top, 'git-env.jsonl');
  const script = `#!${process.execPath}
Promise.all([import('node:fs'), import('node:child_process')]).then(([fs, cp]) => {
  const args = process.argv.slice(2);
  const r = cp.spawnSync(${JSON.stringify(realGit())}, args, { stdio: 'inherit' });
  fs.appendFileSync(${JSON.stringify(dump)}, JSON.stringify({ args, env: { ...process.env }, status: r.status }) + '\\n');
  process.exit(r.status ?? 1);
});
`;
  fs.writeFileSync(path.join(bin, 'git'), script, { mode: 0o755 });
  // the calls recorded since the last take, and the dump emptied
  const take = () => {
    if (!fs.existsSync(dump)) return [];
    const calls = fs.readFileSync(dump, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    fs.rmSync(dump);
    return calls;
  };
  // the names the wrapper's own runtime adds when it starts with an empty environment (macOS's CoreFoundation sets
  // __CF_USER_TEXT_ENCODING in node), measured here so the checks below hold git to the list and nothing else
  execFileSync(path.join(bin, 'git'), ['--version'], { env: {}, stdio: 'ignore' });
  const own = new Set(Object.keys(take()[0].env));
  return { bin, take, own };
}

// a scratch repository: main holds the base, origin/HEAD names it, and the branch work changes the source and its
// test, so the test fails on base and passes on head. The session's environment has the four tokens, the global git
// configuration in a file of its own, the wrapper first on PATH, and CLI10_TESTS_SAW, a name off the list.
function scratch(t) {
  const top = fs.mkdtempSync(path.join(os.tmpdir(), 'truedone-cligitenv-'));
  t.after(() => fs.rmSync(top, { recursive: true, force: true }));
  const d = path.join(top, 'repo');
  const home = path.join(top, 'home');
  fs.mkdirSync(d);
  fs.mkdirSync(home);
  const globalConfig = path.join(top, 'gitconfig');
  fs.writeFileSync(globalConfig, `[user]\n\tname = ${USER_NAME}\n\temail = scratch@example.com\n`);
  const setup = { PATH: process.env.PATH, HOME: home, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'Dev One', GIT_AUTHOR_EMAIL: 'dev@example.com', GIT_COMMITTER_NAME: 'Dev One', GIT_COMMITTER_EMAIL: 'dev@example.com' };
  // TEST-01: git maintenance off, so no detached auto-maintenance writes into .git while the directory is removed
  const git = (...a) => execFileSync('git', ['-c', 'maintenance.auto=false', '-c', 'gc.auto=0', ...a], { cwd: d, env: setup, encoding: 'utf8' }).trim();
  const put = (f, body) => { fs.mkdirSync(path.join(d, path.dirname(f)), { recursive: true }); fs.writeFileSync(path.join(d, f), body); };
  git('init', '-q', '-b', 'main');
  put('package.json', '{ "name": "demo", "private": true, "type": "module", "scripts": { "test": "node --test" } }\n');
  put('src/add.mjs', SRC_BASE);
  put('test/add.test.mjs', TEST_BASE);
  git('add', '-A'); git('commit', '-qm', 'base');
  git('update-ref', 'refs/remotes/origin/main', 'main');
  git('symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main');
  git('checkout', '-qb', 'work');
  put('src/add.mjs', SRC_HEAD);
  put('test/add.test.mjs', TEST_HEAD);
  git('add', '-A'); git('commit', '-qm', 'Fix add');
  const w = wrapper(top);
  const testsSaw = path.join(top, 'tests-env.jsonl');
  const env = { PATH: `${w.bin}${path.delimiter}${process.env.PATH}`, HOME: home, GIT_CONFIG_GLOBAL: globalConfig, GIT_CONFIG_NOSYSTEM: '1',
    CLI10_TESTS_SAW: testsSaw, ...TOKENS };
  if (process.env.TMPDIR) env.TMPDIR = process.env.TMPDIR;
  const testRuns = () => {
    if (!fs.existsSync(testsSaw)) return [];
    const runs = fs.readFileSync(testsSaw, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    fs.rmSync(testsSaw);
    return runs;
  };
  return { d, w, env, testRuns, status: () => git('status', '--porcelain') };
}

// git's subcommand: the first argument that is neither -c nor -C nor the value either takes
function subcommand(args) {
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '-c' || args[i] === '-C') { i++; continue; }
    return args[i];
  }
  return null;
}

// every git call saw no token and no name off the list, got the names it needs, and answered
function credentialFree(calls, s, what) {
  assert.ok(calls.length >= 8, `${what} ran git through the wrapper (${calls.length} calls)`);
  for (const c of calls) {
    const seen = Object.keys(c.env);
    for (const n of Object.keys(TOKENS)) assert.ok(!seen.includes(n), `${what}: git ${c.args.join(' ')} saw ${n}`);
    assert.deepEqual(seen.filter((n) => !LISTED.includes(n) && !s.w.own.has(n)), [], `${what}: git ${c.args.join(' ')} saw names off the list`);
    assert.equal(c.env.PATH, s.env.PATH, `${what}: PATH reaches git`);
    assert.equal(c.env.HOME, s.env.HOME, `${what}: HOME reaches git`);
    assert.equal(c.env.GIT_CONFIG_GLOBAL, s.env.GIT_CONFIG_GLOBAL, `${what}: GIT_CONFIG_GLOBAL reaches git`);
    assert.equal(c.status, 0, `${what}: git ${c.args.join(' ')} answers`);
  }
  const ran = new Set(calls.map((c) => subcommand(c.args)));
  for (const sub of LOCAL_INPUT) assert.ok(ran.has(sub), `${what} ran git ${sub} (ran: ${[...ran].join(', ')})`);
}

const truedone = (s, ...args) => spawnSync(process.execPath, [CLI, ...args], { cwd: s.d, env: s.env, encoding: 'utf8', timeout: 120_000 });

// main in-process with the real core, as src/bin.mjs wires it, and git handed the session's whole environment
async function wholeEnvironment(s, argv, gitDeps) {
  const stdout = sink(), stderr = sink();
  const noFetch = async (url) => { throw new Error(`no network expected: ${url}`); };
  const code = await main(argv, { analyse, classify, judge, detect, redGreen, restorePending, fetch: noFetch, cwd: s.d, env: s.env, stdin: pipe(), stdout, stderr, ...gitDeps });
  assert.equal(code, 0, `in-process ${argv.join(' ')}: exit ${code}\n${stderr.text}`);
  return JSON.parse(stdout.text);
}

// the child's --json verdict
function verdictOf(r, what) {
  assert.equal(r.status, 0, `${what}: exit ${r.status} ${r.signal ?? ''}\nstderr: ${r.stderr}\nstdout: ${r.stdout}`);
  return JSON.parse(r.stdout);
}

test('npx truedone: git sees no credential from the environment, and the verdict is the one git gives with all of it', async (t) => {
  const s = scratch(t);
  const before = await wholeEnvironment(s, ['--json'], { git: makeGit(s.d, s.env) });
  const whole = s.w.take();
  assert.ok(whole.length >= 8 && whole.every((c) => c.env.GITHUB_TOKEN === TOKENS.GITHUB_TOKEN), 'with the whole environment git sees GITHUB_TOKEN, so the wrapper records it');

  const r = truedone(s, '--json');
  const v = verdictOf(r, 'npx truedone --json');
  credentialFree(s.w.take(), s, 'npx truedone');
  assert.deepEqual(v, before, 'the verdict is unchanged');
  assert.equal(v.verdict, 'unrun', 'the changed test is judged, not run');
  assert.deepEqual(s.testRuns(), [], 'npx truedone runs no test');
});

test('--run on your own branch: git sees no credential, the tests keep the session\'s environment, and the verdict is unchanged', async (t) => {
  const s = scratch(t);
  const before = await wholeEnvironment(s, ['--run', '--json'], { makeGit: (cwd) => makeGit(cwd, s.env) });
  const whole = s.w.take();
  assert.ok(whole.length >= 8 && whole.every((c) => c.env.GITHUB_TOKEN === TOKENS.GITHUB_TOKEN), 'with the whole environment git sees GITHUB_TOKEN, so the wrapper records it');
  s.testRuns();

  const r = truedone(s, '--run', '--json');
  const v = verdictOf(r, 'npx truedone --run --json');
  credentialFree(s.w.take(), s, 'npx truedone --run');
  assert.deepEqual(v, before, 'the verdict is unchanged');
  assert.ok(['proven', 'proven_weak'].includes(v.verdict), `red-green ran and holds: ${v.verdict}`);
  assert.equal(s.status(), '', 'the working tree is as it was');

  // the owner's choice: the tests --run starts on your own branch get the session's environment, tokens and all
  const runs = s.testRuns();
  assert.equal(runs.length, 5, `the test ran twice on base and three times on head (${runs.length} runs)`);
  for (const names of runs) for (const n of [...Object.keys(TOKENS), 'CLI10_TESTS_SAW']) assert.ok(names.includes(n), `a red-green run of the tests saw no ${n}`);
});

test('someone else\'s pull request: the git that clones it keeps S4\'s filtered environment', async (t) => {
  const top = tmp(t, 'truedone-cligitenv-pr-');
  const w = wrapper(top);
  const { url } = remote(t);
  const env = { ...GITENV, PATH: `${w.bin}${path.delimiter}${GITENV.PATH}`, ...TOKENS, CI: '1' };
  const r = await runWithStandIns(['octo/demo#7', '--run', '--yes'], { env, cloneUrl: () => url, tmpdir: tmp(t), stdin: pipe() });
  assert.equal(r.code, 0, r.err);
  const calls = w.take();
  const ran = calls.map((c) => subcommand(c.args));
  // localInput is given the branch the pull request targets, so it reads no origin/HEAD
  for (const sub of ['clone', 'fetch', 'checkout', ...LOCAL_INPUT.filter((x) => x !== 'symbolic-ref')]) assert.ok(ran.includes(sub), `the pull request's run ran git ${sub} (ran: ${[...new Set(ran)].join(', ')})`);
  const s4 = Object.keys(filterEnv(env)).sort();
  for (const c of calls) {
    assert.deepEqual(Object.keys(c.env).filter((n) => !w.own.has(n)).sort(), s4, `git ${c.args.join(' ')} sees S4's filtered environment`);
    assert.equal(c.env.CI, '1', 'a name S4 keeps reaches git');
  }
});
