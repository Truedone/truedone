// CORE-08-AC01 (issue #53): an assertion whose arguments hold a call is counted. The matcher read expect(...) and
// assert(...) only when their arguments had no parentheses, so weakening expect(add(1, 2)).toBe(3), the usual shape of
// a test, went unseen, and a refactor into a call looked like a weakening: the live site showed Tampered for #52. Each
// weakening case is Tampered with a weakened line naming the test; each control gives no weakened line.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyse } from '../src/analyse.mjs';

const pr = { title: '', body: '', author: { login: 'a', type: 'User' } };
const js = (body) => `import { test, expect } from 'vitest';\nimport assert from 'node:assert/strict';\nimport { add, list } from './add.js';\n\ntest('adds', () => {\n${body}\n});\n`;
const run = (path, base, head) => analyse({ files: [{ path, status: 'modified', base, head }], pr, releases: [] });
const weakened = (out) => out.reasons.filter((r) => r.check === 'weakened').map((r) => r.message);

const WEAKENED = {
  'expect(add(1, 2)).toBe(3) becomes toBeDefined()': ['  expect(add(1, 2)).toBe(3);', '  expect(add(1, 2)).toBeDefined();'],
  'assert.equal(add(1, 2), 3) becomes assert.ok(add(1, 2))': ['  assert.equal(add(1, 2), 3);', '  assert.ok(add(1, 2));'],
  'one of two assert.equal(add(..)) lines is deleted': ['  assert.equal(add(1, 2), 3);\n  assert.equal(add(2, 2), 4);', '  assert.equal(add(1, 2), 3);'],
  'expect(list()).toEqual([1]) is deleted': ['  expect(list()).toEqual([1]);\n  expect(add(1, 1)).toBe(2);', '  expect(add(1, 1)).toBe(2);'],
  'assert.deepStrictEqual(list(), [1]) becomes a bare assert(list())': ['  assert.deepStrictEqual(list(), [1]);', '  assert(list());'],
};

for (const [name, [base, head]] of Object.entries(WEAKENED)) {
  test(`${name}: Tampered, test adds weakened`, () => {
    for (const path of ['add.test.js', 'add.test.ts']) {
      const out = run(path, js(base), js(head));
      assert.equal(out.verdict, 'tampered', path);
      assert.deepEqual(weakened(out), ['Test adds has a weaker assertion on head.'], path);
    }
  });
}

const KEPT = {
  'assert.equal(seen.length, 5) becomes assert.equal(runsOf(seen), 5)': ['  assert.equal(seen.length, 5);', '  assert.equal(runsOf(seen), 5);'],
  "#52's pair: seen[0].includes(..) becomes seen.some(..)": [
    "  assert.equal(seen.length, 5);\n  assert.equal(seen[0].includes('t49.test.js'), true);",
    "  assert.equal(runsOf(seen), 5);\n  assert.equal(seen.some((command) => command.includes('t49.test.js')), true);",
  ],
  'a ")" inside a string in the arguments': ["  expect(add(1, 2)).toBe(3);\n  assert.equal(label(')'), 'x)');", "  expect(add(1, 2)).toBe(3);\n  assert.strictEqual(label(')'), 'x)');"],
  'a regex literal with a ")" in the arguments': ['  assert.equal(/\\)/.test(add(1, 2)), false);', '  assert.strictEqual(/\\)/.test(add(1, 2)), false);'],
};

for (const [name, [base, head]] of Object.entries(KEPT)) {
  test(`${name}: no weakened line, not Tampered`, () => {
    const out = run('add.test.js', js(base), js(head));
    assert.deepEqual(weakened(out), []);
    assert.notEqual(out.verdict, 'tampered');
  });
}
