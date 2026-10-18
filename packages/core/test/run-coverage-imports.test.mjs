// RUN-04-AC03 (D8): with coverage unavailable the condition is imports —
// one hop from the test counts, two hops do not.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { conditionFor } from '../run/coverage.mjs';

function fixture({ testText, changed }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cov-imports-'));
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'test'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'changed.mjs'), 'export const V = 1;\n');
  fs.writeFileSync(path.join(dir, 'test', 'a.test.mjs'), testText);
  return { dir, files: [{ path: 'src/changed.mjs', status: 'modified', base: 'export const V = 0;\n' }], tests: ['test/a.test.mjs'], changed };
}

test('a test importing the changed module one hop away gives imports when coverage is unavailable', () => {
  const f = fixture({ testText: `import { test } from "node:test";\nimport assert from "node:assert/strict";\nimport * as m from "../src/changed.mjs";\ntest("v", () => { assert.equal(m.V, 1); });\n` });
  const verdict = conditionFor({ coverageDir: path.join(f.dir, 'no-coverage-here'), pythonCoverageFile: null, root: f.dir, files: f.files, tests: f.tests });
  assert.equal(verdict.condition, 'imports');
  assert.equal(verdict.linesHold, false);
  assert.equal(verdict.importsHold, true);
});

test('a changed module reached through one intermediate module still counts as imports', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cov-onehop-'));
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'test'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'changed.mjs'), 'export const V = 1;\n');
  fs.writeFileSync(path.join(dir, 'src', 'middle.mjs'), 'export * from "./changed.mjs";\n');
  fs.writeFileSync(path.join(dir, 'test', 'a.test.mjs'), `import { test } from "node:test";\nimport assert from "node:assert/strict";\nimport * as middle from "../src/middle.mjs";\ntest("v", () => { assert.equal(middle.V, 1); });\n`);
  const files = [{ path: 'src/changed.mjs', status: 'modified', base: 'export const V = 0;\n' }];
  const verdict = conditionFor({ coverageDir: path.join(dir, 'none'), pythonCoverageFile: null, root: dir, files, tests: ['test/a.test.mjs'] });
  assert.equal(verdict.condition, 'imports', 'one intermediate is D8\'s one hop away');
});

test('a changed module two intermediates away does not count as imports', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cov-twohop-'));
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'test'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'changed.mjs'), 'export const V = 1;\n');
  fs.writeFileSync(path.join(dir, 'src', 'inner.mjs'), 'export * from "./changed.mjs";\n');
  fs.writeFileSync(path.join(dir, 'src', 'middle.mjs'), 'export * from "./inner.mjs";\n');
  fs.writeFileSync(path.join(dir, 'test', 'a.test.mjs'), `import { test } from "node:test";\nimport assert from "node:assert/strict";\nimport * as middle from "../src/middle.mjs";\ntest("v", () => { assert.equal(middle.V, 1); });\n`);
  const files = [{ path: 'src/changed.mjs', status: 'modified', base: 'export const V = 0;\n' }];
  const verdict = conditionFor({ coverageDir: path.join(dir, 'none'), pythonCoverageFile: null, root: dir, files, tests: ['test/a.test.mjs'] });
  assert.equal(verdict.condition, 'none', 'two intermediates do not count');
});

test('a test that neither covers nor imports gives none', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cov-none-'));
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'test'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'changed.mjs'), 'export const V = 1;\n');
  fs.writeFileSync(path.join(dir, 'test', 'a.test.mjs'), `import { test } from "node:test";\ntest("unrelated", () => {});\n`);
  const files = [{ path: 'src/changed.mjs', status: 'modified', base: 'export const V = 0;\n' }];
  const verdict = conditionFor({ coverageDir: path.join(dir, 'none'), pythonCoverageFile: null, root: dir, files, tests: ['test/a.test.mjs'] });
  assert.equal(verdict.condition, 'none');
});
