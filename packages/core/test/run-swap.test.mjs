import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

function repo() {
  const dir = mkdtempSync(path.join(tmpdir(), 'td-swap-'));
  const made = spawnSync('git', ['init'], { cwd: dir, encoding: 'utf8' });
  assert.equal(made.status, 0, made.stderr);
  return dir;
}

test('modified, added and removed source files swap and come back byte for byte', async () => {
  let swapToBase;
  let restore;
  try {
    ({ swapToBase, restore } = await import('../run/swap.mjs'));
  } catch (e) {
    assert.fail(String(e.message));
  }
  const dir = repo();
  try {
    mkdirSync(path.join(dir, 'src'));
    writeFileSync(path.join(dir, 'src', 'keep.js'), 'export const n = 1\n');
    writeFileSync(path.join(dir, 'src', 'new.js'), 'export const added = true\n');
    writeFileSync(path.join(dir, 'src', 'a.test.js'), 'stays on head\n');
    swapToBase({
      root: dir,
      files: [
        { path: 'src/keep.js', status: 'modified', base: 'export const n = 0\n' },
        { path: 'src/new.js', status: 'added', base: '' },
        { path: 'src/old.js', status: 'removed', base: 'export const old = 1\n' },
        { path: 'src/a.test.js', status: 'modified', base: 'should not apply\n' },
      ],
    });
    assert.equal(readFileSync(path.join(dir, 'src', 'keep.js'), 'utf8'), 'export const n = 0\n');
    assert.equal(existsSync(path.join(dir, 'src', 'new.js')), false);
    assert.equal(readFileSync(path.join(dir, 'src', 'old.js'), 'utf8'), 'export const old = 1\n');
    assert.equal(readFileSync(path.join(dir, 'src', 'a.test.js'), 'utf8'), 'stays on head\n');
    restore(dir);
    assert.equal(readFileSync(path.join(dir, 'src', 'keep.js'), 'utf8'), 'export const n = 1\n');
    assert.equal(readFileSync(path.join(dir, 'src', 'new.js'), 'utf8'), 'export const added = true\n');
    assert.equal(existsSync(path.join(dir, 'src', 'old.js')), false);
    assert.equal(readFileSync(path.join(dir, 'src', 'a.test.js'), 'utf8'), 'stays on head\n');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
