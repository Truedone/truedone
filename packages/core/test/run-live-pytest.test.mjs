import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { detect } from '../run/detect.mjs';
import { redGreen } from '../run/run.mjs';

test('a live pytest repository produces a report', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'td-live-py-'));
  try {
    cpSync(fileURLToPath(new URL('./fixtures/live/pytest/', import.meta.url)), dir, { recursive: true });
    const made = spawnSync('git', ['init'], { cwd: dir, encoding: 'utf8' });
    assert.equal(made.status, 0);
    const found = detect(dir, ['test_ok.py']);
    assert.equal(found[0].runner, 'pytest');
    const report = await redGreen({
      root: dir,
      tests: found,
      files: [],
      base: 'base',
      head: 'head',
    });
    assert.equal(report.schema, 'truedone.report/1');
    assert.equal(report.truncated, false);
    assert.equal(report.could_not_run, null);
    assert.ok(report.tests.length >= 1);
    for (const item of report.tests) {
      assert.equal(item.base.length, 2);
      assert.deepEqual(item.head, ['pass', 'pass', 'pass']);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
