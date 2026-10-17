import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { importsHit } from '../run/coverage.mjs';

function tree() {
  const root = mkdtempSync(path.join(tmpdir(), 'td-imp-'));
  mkdirSync(path.join(root, 'src'));
  writeFileSync(path.join(root, 'src/changed.js'), 'export const n = 1;\n');
  writeFileSync(path.join(root, 'src/mid.js'), 'export { n } from "./changed.js";\n');
  writeFileSync(path.join(root, 'src/other.js'), 'export { n } from "./mid.js";\n');
  writeFileSync(path.join(root, 'one.test.js'), 'import { n } from "./src/mid.js";\nexport const x = n;\n');
  writeFileSync(path.join(root, 'two.test.js'), 'import { n } from "./src/other.js";\nexport const x = n;\n');
  return root;
}

test('one import hop counts and two hops do not', () => {
  const root = tree();
  try {
    assert.equal(importsHit(root, 'one.test.js', ['src/changed.js']), true);
    assert.equal(importsHit(root, 'two.test.js', ['src/changed.js']), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
