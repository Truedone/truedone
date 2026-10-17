import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('a test command in .github/truedone.yml overrides detection', async () => {
  let detect;
  let detectFromManifests;
  try {
    ({ detect, detectFromManifests } = await import('../run/detect.mjs'));
  } catch (e) {
    assert.fail(String(e.message));
  }
  const manifests = { 'package.json': '{"scripts":{"test":"vitest run"}}\n' };
  const found = detectFromManifests(manifests, 'a.test.js');
  assert.match(found.command, /vitest/);
  const over = detectFromManifests(manifests, 'a.test.js', 'npm test {files}');
  assert.equal(over.command, 'npm test {files}');
  assert.equal(over.runner, 'vitest');

  const dir = mkdtempSync(path.join(tmpdir(), 'td-cfg-'));
  try {
    writeFileSync(path.join(dir, 'package.json'), '{"scripts":{"test":"vitest run"}}\n');
    mkdirSync(path.join(dir, '.github'));
    writeFileSync(path.join(dir, '.github', 'truedone.yml'), 'test: echo {files}\n');
    const rows = detect(dir, ['a.test.js']);
    assert.equal(rows[0].command, 'echo {files}');
    assert.equal(rows[0].runner, 'vitest');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
