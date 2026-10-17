import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const script = path.join(root, 'tools/check-deps.mjs');

function run(dir) {
  return spawnSync(process.execPath, [script, dir], { cwd: root, encoding: 'utf8' });
}

test('a package.json with a devDependency fails', () => {
  const r = run(path.join(root, 'tools/test/fixtures/with-deps'));
  assert.notEqual(r.status, 0);
  assert.match(`${r.stdout}${r.stderr}`, /devDependencies/);
});

test('a clean tree passes', () => {
  const r = run(root);
  assert.equal(r.status, 0, r.stderr);
});
