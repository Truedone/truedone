// CLI-09 (D7, PV-C08): --run gives red-green the base content of every changed file that is not added, from git show
// <merge base>:<path>, as the action does. The first case runs the bundled packages/cli/truedone.mjs as a child process,
// with nothing faked, in a scratch repository: a source fix whose test fails on base and passes on head is Proven or
// Proven (weak), never Could not run. main moves on after the branch point with a source that already sums, so a base
// taken from main's tip instead of the merge base would pass on base too and prove nothing. The child's environment is
// built here, so the test runner's NODE_TEST_CONTEXT never reaches the red-green runs. The second case holds what each
// side reads: analyse keeps the input it reads today, and red-green gets the merge base content of a modified, a
// renamed and a removed source file, and none for an added one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { run, verdict, report } from './lib/run-fakes.mjs';

const CLI = fileURLToPath(new URL('../truedone.mjs', import.meta.url));
const RECORD = '.git/truedone-restore';
const BASE = 'export const add = (a, b) => a - b;\n';
const HEAD = 'export const add = (a, b) => a + b;\n';
const MAIN_LATER = 'export const add = (a, b) => b + a;\n';
const TEST_BASE = "import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { add } from '../src/add.mjs';\n\ntest('add is a function', () => assert.equal(typeof add, 'function'));\n";
const TEST_HEAD = `${TEST_BASE}test('add sums', () => assert.equal(add(2, 3), 5));\n`;

function scratch(t) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'truedone-base-'));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  return d;
}

function envFor(home) {
  const env = { PATH: process.env.PATH, HOME: home, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'Dev One', GIT_AUTHOR_EMAIL: 'dev@example.com', GIT_COMMITTER_NAME: 'Dev One', GIT_COMMITTER_EMAIL: 'dev@example.com' };
  if (process.env.TMPDIR) env.TMPDIR = process.env.TMPDIR;
  return env;
}

// TEST-01: git maintenance off, so no detached auto-maintenance writes into .git while the directory is removed
const git = (cwd, env, ...a) => execFileSync('git', ['-c', 'maintenance.auto=false', '-c', 'gc.auto=0', ...a], { cwd, env, encoding: 'utf8' }).trim();
function put(dir, f, body) { fs.mkdirSync(path.join(dir, path.dirname(f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), body); }
const read = (dir, f) => fs.readFileSync(path.join(dir, f), 'utf8');

// main holds the base; branch work fixes src/add.mjs and adds a test that fails on base and passes on head; main then
// moves on with a source of its own
function sourceFix(t, extra = {}) {
  const top = scratch(t);
  const d = path.join(top, 'repo');
  const env = envFor(path.join(top, 'home'));
  fs.mkdirSync(d);
  fs.mkdirSync(env.HOME);
  git(d, env, 'init', '-q', '-b', 'main');
  put(d, 'package.json', '{ "name": "demo", "private": true, "type": "module", "scripts": { "test": "node --test" } }\n');
  put(d, 'src/add.mjs', BASE);
  put(d, 'test/add.test.mjs', TEST_BASE);
  for (const [f, body] of Object.entries(extra.base ?? {})) put(d, f, body);
  git(d, env, 'add', '-A'); git(d, env, 'commit', '-qm', 'base');
  const mergeBase = git(d, env, 'rev-parse', 'HEAD');
  git(d, env, 'checkout', '-qb', 'work');
  put(d, 'src/add.mjs', HEAD);
  put(d, 'test/add.test.mjs', TEST_HEAD);
  extra.branch?.(d, env);
  git(d, env, 'add', '-A'); git(d, env, 'commit', '-qm', 'Fix add');
  git(d, env, 'checkout', '-q', 'main');
  put(d, 'src/add.mjs', MAIN_LATER);
  git(d, env, 'commit', '-qam', 'main moves on');
  git(d, env, 'checkout', '-q', 'work');
  return { d, env, mergeBase };
}

test('a source fix whose test fails on base and passes on head: --run proves it red-green, never Could not run', (t) => {
  const { d, env, mergeBase } = sourceFix(t);
  const r = spawnSync(process.execPath, [CLI, '--run'], { cwd: d, env, encoding: 'utf8', timeout: 120_000 });
  assert.equal(r.status, 0, `exit ${r.status} ${r.signal ?? ''}\nstderr: ${r.stderr}\nstdout: ${r.stdout}`);
  const [first, second] = r.stdout.split('\n');
  assert.match(first, /^truedone: Proven( \(weak\))?$/, r.stdout);
  assert.equal(second, `  the working tree, against ${mergeBase.slice(0, 12)}, with red-green`);
  assert.equal(read(d, 'src/add.mjs'), HEAD);
  assert.equal(fs.existsSync(path.join(d, RECORD)), false, 'no record is left');
  assert.equal(git(d, env, 'status', '--porcelain'), '', 'the working tree is as it was');
});

test('red-green gets the merge base content of every changed file that is not added; analyse reads what it reads today', async (t) => {
  const { d, env } = sourceFix(t, {
    base: { 'src/old-name.mjs': 'export const kept = 1;\n', 'src/gone.mjs': 'export const gone = 1;\n' },
    branch: (dir, e) => {
      git(dir, e, 'mv', 'src/old-name.mjs', 'src/new-name.mjs');
      git(dir, e, 'rm', '-q', 'src/gone.mjs');
      put(dir, 'src/added.mjs', 'export const added = 1;\n');
    },
  });
  let input;
  let given;
  const r = await run(['--run'], {
    cwd: d, env,
    analyse: (i) => { input = i; return verdict(); },
    redGreen: async (o) => { given = o; return report(); },
  });
  assert.equal(r.code, 0, r.err);
  const by = (files) => Object.fromEntries(files.map((f) => [f.path, f]));
  const statik = by(input.files);
  const rg = by(given.files);
  assert.deepEqual(Object.keys(rg).sort(), ['src/add.mjs', 'src/added.mjs', 'src/gone.mjs', 'src/new-name.mjs', 'test/add.test.mjs']);
  assert.equal(rg['src/new-name.mjs'].previous_path, 'src/old-name.mjs');
  assert.equal(rg['src/add.mjs'].base, BASE, 'modified: the merge base, not main as it is now');
  assert.equal(rg['src/new-name.mjs'].base, 'export const kept = 1;\n', 'renamed: under its previous path');
  assert.equal(rg['src/gone.mjs'].base, 'export const gone = 1;\n', 'removed: put back on base');
  assert.equal(rg['src/added.mjs'].base, undefined, 'added: no base');
  assert.equal(rg['test/add.test.mjs'].base, TEST_BASE);
  for (const p of ['src/add.mjs', 'src/added.mjs', 'src/gone.mjs', 'src/new-name.mjs']) assert.equal(statik[p].base, undefined, `analyse reads no base for ${p}`);
  assert.equal(statik['test/add.test.mjs'].base, TEST_BASE);
});
