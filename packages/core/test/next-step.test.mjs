// CORE-09-AC01 (issue #56): result.next names only the groups of reasons that give the verdict. A PR whose only finding
// is a weakened assertion is told to restore a test, never to pin a step it did not touch; a removed truedone step is told
// to pin, not to restore; both get both, restore first. A test or step change whose reasons give only review is asked to
// confirm it. A lesser finding, such as the unrun line every changed test brings, adds nothing to next. Each reason
// carries the verdict it alone gives, and judge() builds next the same way.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyse } from '../src/analyse.mjs';
import { judge } from '../src/judge.mjs';

const pr = { title: '', body: '', author: { login: 'a', type: 'User' } };
const run = (files, releases = []) => analyse({ files, pr, releases });
const weakened = { path: 'add.test.js', base: "test('adds', () => { expect(add(1, 2)).toBe(3); });\n", head: "test('adds', () => { expect(add(1, 2)).toBeDefined(); });\n" };
const stepGone = { path: '.github/workflows/ci.yml', base: 'jobs:\n  t:\n    steps:\n      - uses: truedone/truedone@v1.2.0\n', head: 'jobs:\n  t:\n    steps:\n      - run: npm test\n' };
const stepRelease = { path: '.github/workflows/ci.yml', base: 'jobs:\n  t:\n    steps:\n      - uses: truedone/truedone@v1.2.0\n', head: 'jobs:\n  t:\n    steps:\n      - uses: truedone/truedone@v1.2.3\n' };
const snapshot = { path: 'add.test.js.snap', base: 'exports[`adds 1`] = `1`;\n', head: 'exports[`adds 1`] = `2`;\n' };
const RESTORE = 'Restore an equivalent test.';
const PIN = 'Pin the truedone step to a published release.';
const pinWords = /\bpin\b/i;
const restoreWords = /\brestore\b/i;

test('a weakened assertion alone: restore, and no word of a step', () => {
  const out = run([weakened]);
  assert.equal(out.verdict, 'tampered');
  assert.equal(out.next, RESTORE);
  assert.doesNotMatch(out.next, pinWords);
});

test('a removed truedone step alone: pin, and no word of restoring a test', () => {
  const out = run([stepGone]);
  assert.equal(out.verdict, 'tampered');
  assert.equal(out.next, PIN);
  assert.doesNotMatch(out.next, restoreWords);
});

test('both: one sentence each, restore first', () => {
  const out = run([weakened, stepGone]);
  assert.equal(out.verdict, 'tampered');
  assert.equal(out.next, `${RESTORE} ${PIN}`);
});

test('changes that give only review are asked to confirm, not to restore or pin', () => {
  const snap = run([snapshot]);
  assert.equal(snap.verdict, 'review');
  assert.equal(snap.next, 'Confirm the test change is intended.');
  const release = run([stepRelease], ['v1.2.0', 'v1.2.3']);
  assert.equal(release.verdict, 'review');
  assert.equal(release.next, 'Confirm the step change is intended.');
  for (const out of [snap, release]) assert.doesNotMatch(out.next, /\b(restore|pin)\b/i);
});

test('a lesser finding adds nothing: a Tampered PR with a review snapshot is told only to restore', () => {
  const out = run([weakened, snapshot]);
  assert.equal(out.verdict, 'tampered');
  assert.equal(out.next, RESTORE);
  assert.ok(out.reasons.some((r) => r.check === 'unrun' && r.verdict === 'unrun'), 'the unrun line is still there');
});

test('a verdict whose reasons fall in no group keeps its own sentence', () => {
  assert.equal(run([{ path: 'src/add.js', base: 'a\n', head: 'b\n' }]).next, 'Add a test that fails before the change and passes after it.');
  assert.equal(run([{ path: 'README.md', base: 'a\n', head: 'b\n' }]).next, 'Nothing.');
});

test('each reason carries the verdict it alone gives', () => {
  const removed = { path: 'a.test.js', base: "import { add } from './foo.js';\ntest('adds', () => { expect(add(1, 1)).toBe(2); });\n", head: '' };
  const source = { path: 'foo.js', base: 'export function add(a, b) { return a + b; }\n', head: '' };
  const out = run([weakened, stepGone, snapshot]);
  assert.deepEqual(out.reasons.map((r) => [r.check, r.verdict]), [['weakened', 'tampered'], ['snapshot', 'review'], ['step', 'tampered'], ['unrun', 'unrun']]);
  // a removed test is tampering while its source stays, and review when the source went too
  assert.deepEqual(run([removed]).reasons.map((r) => [r.check, r.verdict]), [['deleted', 'tampered'], ['unrun', 'unrun']]);
  assert.deepEqual(run([removed, source]).reasons.map((r) => [r.check, r.verdict]), [['deleted', 'review'], ['unrun', 'unrun']]);
  assert.deepEqual(run([{ path: 'src/add.js', base: 'a\n', head: 'b\n' }]).reasons.map((r) => [r.check, r.verdict]), [['no_test', 'no_evidence']]);
  for (const r of out.reasons) assert.ok(typeof r.verdict === 'string', r.check);
});

test('judge() builds next the same way: a standing static verdict, and a red-green one', () => {
  const st = run([weakened]);
  assert.equal(judge(st, []).next, RESTORE);
  const proven = { schema: 'truedone.report/1', could_not_run: null, truncated: false, tests: [{ file: 'add.test.js', name: 'adds', base: ['fail:assertion', 'fail:assertion'], head: ['pass', 'pass', 'pass'], condition: 'lines' }] };
  const out = judge(run([{ path: 'add.test.js', base: "test('adds', () => {});\n", head: "test('adds', () => { expect(add(1, 2)).toBe(3); });\n" }]), [proven]);
  assert.equal(out.verdict, 'proven');
  assert.equal(out.next, 'Review the rest of the change as usual.');
  assert.deepEqual(out.reasons.map((r) => [r.check, r.verdict]), [['red_green', 'proven']]);
});
