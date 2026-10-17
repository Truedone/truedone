import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

function run(dir) {
  const out = spawnSync(process.execPath, ['--input-type=module', '-e', 'import { v } from "./packages/lib/index.js"; console.log(v)'], {
    cwd: dir,
    encoding: 'utf8',
  });
  assert.equal(out.status, 0, out.stderr);
  return out.stdout.trim();
}

test('in a workspace the base phase executes base code', async () => {
  let swapToBase;
  let restore;
  try {
    ({ swapToBase, restore } = await import('../run/swap.mjs'));
  } catch (e) {
    assert.fail(String(e.message));
  }
  const dir = mkdtempSync(path.join(tmpdir(), 'td-ws-'));
  const made = spawnSync('git', ['init'], { cwd: dir, encoding: 'utf8' });
  assert.equal(made.status, 0, made.stderr);
  try {
    mkdirSync(path.join(dir, 'packages', 'lib'), { recursive: true });
    writeFileSync(path.join(dir, 'package.json'), '{"private":true,"type":"module"}\n');
    writeFileSync(path.join(dir, 'packages', 'lib', 'package.json'), '{"name":"@ws/lib","type":"module"}\n');
    writeFileSync(path.join(dir, 'packages', 'lib', 'index.js'), 'export const v = "head"\n');
    writeFileSync(path.join(dir, 'packages', 'lib', 'index.test.js'), 'stays\n');
    assert.equal(run(dir), 'head');
    swapToBase({
      root: dir,
      files: [
        { path: 'packages/lib/index.js', status: 'modified', base: 'export const v = "base"\n' },
        { path: 'packages/lib/index.test.js', status: 'modified', base: 'no\n' },
      ],
    });
    assert.equal(run(dir), 'base');
    restore(dir);
    assert.equal(run(dir), 'head');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
