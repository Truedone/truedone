// CLI-07 (PV-L05, S1): the real command line runs --run on your own branch, and first puts back a killed run. Each case
// runs the bundled packages/cli/truedone.mjs as a child process, with no stand-in for any part of it, in a scratch
// repository whose branch work changes src/add.mjs and its test against main. The child's environment is built here,
// not copied from this process, so the test runner's NODE_TEST_CONTEXT never reaches the red-green runs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { VERDICTS } from '../src/output.mjs';

const CLI = fileURLToPath(new URL('../truedone.mjs', import.meta.url));
const SWAP = new URL('../../core/run/swap.mjs', import.meta.url).href;
const RECORD = '.git/truedone-restore';
const BASE = 'export const add = (a, b) => a - b;\n';
const HEAD = 'export const add = (a, b) => a + b;\n';
const TEST_BASE = "import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { add } from '../src/add.mjs';\n\ntest('add is a function', () => assert.equal(typeof add, 'function'));\n";
const TEST_HEAD = `${TEST_BASE}test('add sums', () => assert.equal(add(2, 3), 5));\n`;

function scratch(t) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'truedone-own-'));
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

// main holds the base, branch work changes the source and adds a test that fails on base and passes on head
function ownBranch(t) {
  const top = scratch(t);
  const d = path.join(top, 'repo');
  const env = envFor(path.join(top, 'home'));
  fs.mkdirSync(d);
  fs.mkdirSync(env.HOME);
  git(d, env, 'init', '-q', '-b', 'main');
  put(d, 'package.json', '{ "name": "demo", "private": true, "type": "module", "scripts": { "test": "node --test" } }\n');
  put(d, 'src/add.mjs', BASE);
  put(d, 'test/add.test.mjs', TEST_BASE);
  git(d, env, 'add', '-A'); git(d, env, 'commit', '-qm', 'base');
  git(d, env, 'checkout', '-qb', 'work');
  put(d, 'src/add.mjs', HEAD);
  put(d, 'test/add.test.mjs', TEST_HEAD);
  git(d, env, 'add', '-A'); git(d, env, 'commit', '-qm', 'Fix add');
  return { d, env, main: git(d, env, 'rev-parse', 'main') };
}

const truedone = (d, env, ...args) => spawnSync(process.execPath, [CLI, ...args], { cwd: d, env, encoding: 'utf8', timeout: 120_000 });

// the readable form's first two lines: the verdict, and what was judged
function holdsVerdict(r, main) {
  assert.equal(r.status, 0, `exit ${r.status} ${r.signal ?? ''}\nstderr: ${r.stderr}\nstdout: ${r.stdout}`);
  assert.doesNotMatch(r.stderr, /internal error/);
  const [first, second] = r.stdout.split('\n');
  const named = /^truedone: (.+?)( \(partial\))?$/.exec(first);
  assert.ok(named && Object.values(VERDICTS).includes(named[1]), `a verdict line: ${first}`);
  assert.equal(second, `  the working tree, against ${main.slice(0, 12)}, with red-green`);
}

test('a source and test change on your own branch: --run exits 0 with a verdict line and leaves the tree as it was', (t) => {
  const { d, env, main } = ownBranch(t);
  const r = truedone(d, env, '--run');
  holdsVerdict(r, main);
  assert.equal(read(d, 'src/add.mjs'), HEAD);
  assert.equal(fs.existsSync(path.join(d, RECORD)), false, 'no record is left');
  assert.equal(git(d, env, 'status', '--porcelain'), '', 'the working tree is as it was');
});

// A run killed while swapped: core/run's own swapToBase writes the record and puts the base bytes in place (D7: a
// modified file gets its base content), and the process is killed with SIGKILL before it restores anything.
function killedWhileSwapped(d, env) {
  const script = `import { swapToBase } from ${JSON.stringify(SWAP)};\n`
    + `swapToBase({ root: ${JSON.stringify(d)}, files: [{ path: 'src/add.mjs', status: 'modified', base: ${JSON.stringify(BASE)} }] });\n`
    + "process.stdout.write('SWAPPED\\n');\nsetInterval(() => {}, 1000);\n";
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, ['--input-type=module', '-e', script], { cwd: d, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let swapped = false;
    const ended = (code) => reject(new Error(`the run ended (${code}) before it swapped anything: ${out.trim()}`));
    p.on('exit', ended);
    p.stderr.on('data', (x) => { out += x; });
    p.stdout.on('data', (x) => {
      out += x;
      if (swapped || !out.includes('SWAPPED\n')) return;
      swapped = true;
      p.off('exit', ended);
      p.on('exit', (code, signal) => resolve(signal));
      p.kill('SIGKILL');
    });
  });
}

test('a restore record left by a killed run is put back before the run reads the tree', async (t) => {
  const { d, env, main } = ownBranch(t);
  assert.equal(await killedWhileSwapped(d, env), 'SIGKILL');
  assert.equal(read(d, 'src/add.mjs'), BASE, 'the kill left the base bytes in place');
  assert.ok(fs.existsSync(path.join(d, RECORD)), 'and the record');

  const found = truedone(d, env, '--run');
  holdsVerdict(found, main);
  assert.equal(read(d, 'src/add.mjs'), HEAD, 'head is back');
  assert.equal(fs.existsSync(path.join(d, RECORD)), false, 'the record is gone');
  assert.equal(git(d, env, 'status', '--porcelain'), '', 'the working tree is as it was before the killed run');

  // A run that put the files back only later, inside red-green, would have read src/add.mjs at its base bytes, listed
  // no source change and judged a different input. The run that found the record judged what a run with none judges.
  const none = truedone(d, env, '--run');
  holdsVerdict(none, main);
  assert.equal(found.stdout, none.stdout, 'the run that found the record read the same tree as a run with no record');
});
