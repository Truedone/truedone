// PLG-12 (PV-L03, PV-L05, PV-L06): git runs with an environment that holds no credential. makeGit's default environment
// is built from a fixed list of names git needs to read a local repository and the user's own git configuration, so a
// token in the session's environment never reaches a process that reads only the local repository. The test sets four
// such tokens in this process, puts a git wrapper first on PATH that records the environment it was started with and
// then runs the real git, and runs the real makeGit and localInput against a scratch repository. The wrapper's dump
// path and the real git's path are written into the wrapper itself, since no other name reaches it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { localInput, makeGit } from '../src/local.mjs';
import { classify } from '../../core/core.mjs';

// the names PLG-12 lists; SYSTEMROOT, COMSPEC and PATHEXT are for Windows
const LISTED = ['PATH', 'HOME', 'USER', 'LOGNAME', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TMPDIR', 'TZ', 'XDG_CONFIG_HOME',
  'GIT_CONFIG_GLOBAL', 'GIT_CONFIG_NOSYSTEM', 'GIT_CEILING_DIRECTORIES', 'SYSTEMROOT', 'COMSPEC', 'PATHEXT'];
const TOKENS = { GITHUB_TOKEN: 'plg12-github-token', GH_TOKEN: 'plg12-gh-token', AWS_SECRET_ACCESS_KEY: 'plg12-aws-secret', NPM_TOKEN: 'plg12-npm-token' };
// names on the list this test leaves unset, so git must not see them at all
const UNSET = ['LC_ALL', 'TZ', 'XDG_CONFIG_HOME', 'GIT_CEILING_DIRECTORIES'];
const USER_NAME = 'Scratch Global User';

const SRC_BASE = 'export const add = (a, b) => a - b;\n';
const SRC_HEAD = 'export const add = (a, b) => a + b;\n';
const TEST_BASE = "import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { add } from '../src/add.mjs';\n\ntest('add is a function', () => assert.equal(typeof add, 'function'));\n";
const TEST_HEAD = `${TEST_BASE}test('add sums', () => assert.equal(add(2, 3), 5));\n`;
const UNTRACKED = "import test from 'node:test';\ntest('new', () => {});\n";

function realGit() {
  for (const dir of (process.env.PATH ?? '').split(path.delimiter).filter(Boolean)) {
    const p = path.join(dir, 'git');
    try { fs.accessSync(p, fs.constants.X_OK); if (fs.statSync(p).isFile()) return p; } catch { /* not here */ }
  }
  throw new Error('no git on PATH');
}

// a scratch repository: main holds the base, origin/HEAD names it, and the branch work changes the source and the
// test, with one untracked test file, so every git call localInput makes has something to answer
function scratch(t) {
  const top = fs.mkdtempSync(path.join(os.tmpdir(), 'truedone-gitenv-'));
  t.after(() => fs.rmSync(top, { recursive: true, force: true }));
  const d = path.join(top, 'repo');
  const home = path.join(top, 'home');
  fs.mkdirSync(d);
  fs.mkdirSync(home);
  const globalConfig = path.join(top, 'gitconfig');
  fs.writeFileSync(globalConfig, `[user]\n\tname = ${USER_NAME}\n\temail = scratch@example.com\n`);
  const env = { PATH: process.env.PATH, HOME: home, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'Dev One', GIT_AUTHOR_EMAIL: 'dev@example.com', GIT_COMMITTER_NAME: 'Dev One', GIT_COMMITTER_EMAIL: 'dev@example.com' };
  // TEST-01: git maintenance off, so no detached auto-maintenance writes into .git while the directory is removed
  const git = (...a) => execFileSync('git', ['-c', 'maintenance.auto=false', '-c', 'gc.auto=0', ...a], { cwd: d, env, encoding: 'utf8' }).trim();
  const put = (f, body) => { fs.mkdirSync(path.join(d, path.dirname(f)), { recursive: true }); fs.writeFileSync(path.join(d, f), body); };
  git('init', '-q', '-b', 'main');
  put('package.json', '{ "name": "demo", "private": true, "type": "module" }\n');
  put('src/add.mjs', SRC_BASE);
  put('test/add.test.mjs', TEST_BASE);
  git('add', '-A'); git('commit', '-qm', 'base');
  git('update-ref', 'refs/remotes/origin/main', 'main');
  git('symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main');
  git('checkout', '-qb', 'work');
  put('src/add.mjs', SRC_HEAD);
  put('test/add.test.mjs', TEST_HEAD);
  git('add', '-A'); git('commit', '-qm', 'Fix add');
  put('test/new.test.mjs', UNTRACKED);
  return { top, d, home, globalConfig, main: git('rev-parse', 'main') };
}

// a git first on PATH that appends { args, names, env, status } for each call to a dump file, then exits as the real
// git did; node is named by its absolute path, so the wrapper needs no PATH of its own
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
  const calls = () => (fs.existsSync(dump) ? fs.readFileSync(dump, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
  // the names the wrapper's own runtime adds when it starts with an empty environment (macOS's CoreFoundation sets
  // __CF_USER_TEXT_ENCODING in node), measured here so the check below holds git to the list and nothing else
  execFileSync(path.join(bin, 'git'), ['--version'], { env: {}, stdio: 'ignore' });
  const own = new Set(Object.keys(calls()[0].env));
  fs.rmSync(dump);
  return { bin, calls, own };
}

// git's subcommand: the first argument that is neither -c nor -C nor the value either takes
function subcommand(args) {
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '-c' || args[i] === '-C') { i++; continue; }
    return args[i];
  }
  return null;
}

// sets this process's environment as a session with tokens in it would have it, and puts it back after the test
function session(t, { bin, home, globalConfig }) {
  const names = ['PATH', 'HOME', 'GIT_CONFIG_GLOBAL', 'GIT_CONFIG_NOSYSTEM', ...UNSET, ...Object.keys(TOKENS)];
  const saved = Object.fromEntries(names.map((n) => [n, process.env[n]]));
  t.after(() => { for (const [n, v] of Object.entries(saved)) { if (v === undefined) delete process.env[n]; else process.env[n] = v; } });
  process.env.PATH = `${bin}${path.delimiter}${process.env.PATH}`;
  process.env.HOME = home;
  process.env.GIT_CONFIG_GLOBAL = globalConfig;
  process.env.GIT_CONFIG_NOSYSTEM = '1';
  for (const n of UNSET) delete process.env[n];
  Object.assign(process.env, TOKENS);
}

test('makeGit with no env: git sees no token from the environment, and every git call localInput makes still answers', (t) => {
  const s = scratch(t);
  const w = wrapper(s.top);
  session(t, { bin: w.bin, home: s.home, globalConfig: s.globalConfig });
  assert.equal(process.env.GITHUB_TOKEN, TOKENS.GITHUB_TOKEN, 'the tokens are set in the parent');

  const { input, base, branch } = localInput(s.d, { classify });
  const calls = w.calls();
  assert.ok(calls.length >= 8, `localInput ran git through the wrapper (${calls.length} calls)`);

  for (const c of calls) {
    const seen = Object.keys(c.env);
    for (const n of Object.keys(TOKENS)) assert.ok(!seen.includes(n), `git ${c.args.join(' ')} saw ${n}`);
    const extra = seen.filter((n) => !LISTED.includes(n) && !w.own.has(n));
    assert.deepEqual(extra, [], `git ${c.args.join(' ')} saw names off the list`);
    for (const n of UNSET) assert.ok(!seen.includes(n), `git ${c.args.join(' ')} saw ${n}, which is not set`);
    assert.equal(c.env.PATH, process.env.PATH, 'PATH reaches git');
    assert.equal(c.env.HOME, s.home, 'HOME reaches git');
    assert.equal(c.env.GIT_CONFIG_GLOBAL, s.globalConfig, 'GIT_CONFIG_GLOBAL reaches git');
    assert.equal(c.env.GIT_CONFIG_NOSYSTEM, '1', 'GIT_CONFIG_NOSYSTEM reaches git');
    assert.equal(c.status, 0, `git ${c.args.join(' ')} answers`);
  }
  const ran = new Set(calls.map((c) => subcommand(c.args)));
  for (const sub of ['rev-parse', 'symbolic-ref', 'merge-base', 'diff', 'ls-files', 'show', 'log', 'config']) assert.ok(ran.has(sub), `localInput ran git ${sub} (ran: ${[...ran].join(', ')})`);

  // what those answers built
  assert.equal(base, s.main, 'merge-base answered');
  assert.equal(branch, 'refs/remotes/origin/main', 'symbolic-ref origin/HEAD answered');
  assert.deepEqual(input.files.map((f) => [f.path, f.status]), [['src/add.mjs', 'modified'], ['test/add.test.mjs', 'modified'], ['test/new.test.mjs', 'added']], 'diff --name-status and ls-files answered');
  assert.match(input.files[0].patch, /^@@ .*\n-export const add = \(a, b\) => a - b;\n\+export const add = \(a, b\) => a \+ b;$/, 'diff -U3 answered');
  assert.equal(input.files[1].base, TEST_BASE, 'show base:path answered');
  assert.equal(input.files[1].head, TEST_HEAD);
  assert.equal(input.files[2].head, UNTRACKED);
  assert.equal(input.pr.title, 'Fix add', 'log -1 answered');
  assert.equal(input.pr.author.login, USER_NAME, 'config user.name answered from the file GIT_CONFIG_GLOBAL names');
});

test('a caller that passes env still decides what git sees', (t) => {
  const s = scratch(t);
  const w = wrapper(s.top);
  session(t, { bin: w.bin, home: s.home, globalConfig: s.globalConfig });
  const env = { PATH: process.env.PATH, GIT_CONFIG_GLOBAL: s.globalConfig, GIT_CONFIG_NOSYSTEM: '1', PLG12_CALLER: 'kept', GH_TOKEN: 'the caller passed it' };
  assert.equal(makeGit(s.d, env)(['config', 'user.name']), USER_NAME);
  const [c] = w.calls();
  assert.deepEqual(Object.keys(c.env).filter((n) => !w.own.has(n)).sort(), Object.keys(env).sort(), 'git sees exactly the names the caller passed');
  assert.equal(c.env.PLG12_CALLER, 'kept');
  assert.equal(c.env.GH_TOKEN, 'the caller passed it');
  assert.equal(c.env.GITHUB_TOKEN, undefined, 'the session\'s other tokens stay out');
});
