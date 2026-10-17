import { test } from 'node:test';
import assert from 'node:assert/strict';
import { judge } from '../src/checks.mjs';

test('an assertion moved between two tests in one file is tampered', () => {
  const base = [
    "test('a', () => { expect(1).toBe(1); expect(2).toBe(2); });",
    "test('b', () => { expect(3).toBe(3); });",
  ].join('\n');
  const head = [
    "test('a', () => { expect(1).toBe(1); });",
    "test('b', () => { expect(3).toBe(3); expect(2).toBe(2); });",
  ].join('\n');
  assert.equal(judge({ files: [{ path: 'a.test.js', base, head }] }), 'tampered');
});

test('a test moved to another file is not a finding', () => {
  const body = "test('adds', () => { expect(1).toBe(1); });\n";
  assert.equal(judge({
    files: [
      { path: 'a.test.js', base: body, head: '' },
      { path: 'b.test.js', base: '', head: body },
    ],
  }), 'unrun');
});
