// CORE-10-AC01: two tests of one name pair by position. An unrelated edit to
// such a file gives no weakened finding (PR #22's false Tampered); a real
// weakening of either paired test is still found. Red on main: the old
// last-wins map flagged the unrelated edit.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { staticFindings } from '../src/checks.mjs';

const BASE = `import { add } from '../src/add.mjs';

test('a', () => {
  assert.equal(add(1, 2), 3);
  assert.equal(add(2, 3), 5);
});

test('a', () => {
  assert.ok(add(1, 1));
});
`;

function findingsFor(head) {
  return staticFindings({ files: [{ path: 'per-test.test.mjs', base: BASE, head }] });
}

test('an unrelated edit to a file with two same-named tests gives no weakened finding', () => {
  const head = BASE.replace("from '../src/add.mjs';", "from '../src/add.mjs'; // touched");
  const f = findingsFor(head);
  assert.equal(f.verdict, 'unrun', `the verdict is ${f.verdict}: ${JSON.stringify(f.reasons)}`);
  assert.equal(f.reasons.some((r) => r.check === 'weakened'), false, 'no weakened finding for an unrelated edit');
});

test('a real weakening of the first same-named test is still found', () => {
  const head = BASE.replace('  assert.equal(add(1, 2), 3);\n', '');
  const f = findingsFor(head);
  const weak = f.reasons.find((r) => r.check === 'weakened');
  assert.ok(weak, 'the weakening is found');
  assert.equal(weak.verdict, 'tampered');
});

test('a real weakening of the second same-named test is still found', () => {
  const head = BASE.replace('  assert.ok(add(1, 1));\n', '');
  const f = findingsFor(head);
  const weak = f.reasons.find((r) => r.check === 'weakened');
  assert.ok(weak, "the second test's weakening is found by its position");
  assert.equal(weak.verdict, 'tampered');
});
