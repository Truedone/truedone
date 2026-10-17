import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

function repo() {
  const dir = mkdtempSync(path.join(tmpdir(), 'td-crash-'));
  const made = spawnSync('git', ['init'], { cwd: dir, encoding: 'utf8' });
  assert.equal(made.status, 0, made.stderr);
  return dir;
}

async function load() {
  try {
    return await import('../run/swap.mjs');
  } catch (e) {
    assert.fail(String(e.message));
  }
}

test('a run killed during the base phase is put back by the next run', async () => {
  const { swapToBase, restore } = await load();
  const dir = repo();
  try {
    mkdirSync(path.join(dir, 'src'));
    writeFileSync(path.join(dir, 'src', 'a.js'), 'export const v = "head"\n');
    swapToBase({ root: dir, files: [{ path: 'src/a.js', status: 'modified', base: 'export const v = "base"\n' }] });
    assert.equal(readFileSync(path.join(dir, 'src', 'a.js'), 'utf8'), 'export const v = "base"\n');
    restore(dir);
    assert.equal(readFileSync(path.join(dir, 'src', 'a.js'), 'utf8'), 'export const v = "head"\n');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('an edit during the run stops the put-back', async () => {
  const { swapToBase, restore } = await load();
  const dir = repo();
  try {
    mkdirSync(path.join(dir, 'src'));
    writeFileSync(path.join(dir, 'src', 'a.js'), 'export const v = "head"\n');
    swapToBase({ root: dir, files: [{ path: 'src/a.js', status: 'modified', base: 'export const v = "base"\n' }] });
    writeFileSync(path.join(dir, 'src', 'a.js'), 'export const v = "other"\n');
    assert.throws(() => restore(dir), /changed during the run/);
    assert.equal(readFileSync(path.join(dir, 'src', 'a.js'), 'utf8'), 'export const v = "other"\n');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
