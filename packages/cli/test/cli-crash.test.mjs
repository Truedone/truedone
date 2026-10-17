// CLI-03-AC03 (PV-L05, S1): a --run killed mid-way, with the changed source files swapped to base, is restored by the
// next run before anything reads the tree. The killed run is a real process (test/fixtures/crash/entry.mjs) killed
// with SIGKILL while swapped; the next run calls core/run's restorePending first (a stand-in that restores from the
// record the way RUN-02 does), and red-green then sees head again.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { run, repo, sh, RECORD } from './lib/run-fakes.mjs';

const ENTRY = fileURLToPath(new URL('./fixtures/crash/entry.mjs', import.meta.url));
const HEAD = 'export const add = (a, b) => a + b;\n';
const BASE = 'export const add = (a, b) => a - b;\n';

// starts the --run that gets killed, and resolves once it has swapped the tree
function swappedRun(root) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [ENTRY, root], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    p.stdout.on('data', (d) => { out += d; if (out.includes('SWAPPED\n')) resolve(p); });
    p.stderr.on('data', (d) => { out += d; });
    p.on('exit', (code) => reject(new Error(`the --run ended (${code}) before it swapped anything: ${out.trim()}`)));
  });
}
const killed = (p) => new Promise((resolve) => { p.removeAllListeners('exit'); p.on('exit', (code, signal) => resolve(signal)); p.kill('SIGKILL'); });

test('a --run killed while swapped leaves the record, and the next run restores head before red-green', async (t) => {
  const d = repo(t);
  const p = await swappedRun(d);
  assert.equal(await killed(p), 'SIGKILL');
  assert.equal(fs.readFileSync(path.join(d, 'src/add.mjs'), 'utf8'), BASE, 'the kill left the base bytes in place');
  assert.ok(fs.existsSync(path.join(d, RECORD)), 'and the record');

  let seen;
  const r = await run(['--run'], { cwd: d, redGreen: async (o) => { seen = fs.readFileSync(path.join(o.root, 'src/add.mjs'), 'utf8'); return (await import('./lib/run-fakes.mjs')).report(); } });
  assert.equal(r.code, 0, r.err);
  assert.equal(r.names[0], 'restorePending', `the next run restored first: ${r.names.join(',')}`);
  assert.equal(seen, HEAD, 'red-green read head, not the base bytes the kill left');
  assert.equal(fs.readFileSync(path.join(d, 'src/add.mjs'), 'utf8'), HEAD);
  assert.equal(fs.existsSync(path.join(d, RECORD)), false, 'the record is gone');
  assert.equal(sh(d, 'status', '--porcelain'), '', 'the working tree is as it was before the killed run');
});

test('with no record, the next run changes nothing before red-green', async (t) => {
  const d = repo(t);
  let seen;
  const r = await run(['--run'], { cwd: d, redGreen: async (o) => { seen = fs.readFileSync(path.join(o.root, 'src/add.mjs'), 'utf8'); return (await import('./lib/run-fakes.mjs')).report(); } });
  assert.equal(r.code, 0, r.err);
  assert.equal(seen, HEAD);
  assert.equal(sh(d, 'status', '--porcelain'), '');
});
