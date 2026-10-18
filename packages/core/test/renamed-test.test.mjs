// CORE-10-AC02: a removed test that a new test in the same file matches under
// the Equivalent rule counts as moved (unrun), not deleted; one with no
// equivalent stays deleted. Red on main: PR #39's rename was Tampered.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { staticFindings } from '../src/checks.mjs';

const BASE = `import { route } from './route.mjs';

test('a pasted github.com or truedone.dev link is routed', () => {
  assert.equal(route('github.com/o/r'), 'github');
  assert.equal(route('truedone.dev/why'), 'site');
});
`;

test('a rename whose new test covers the old assertions counts as moved', () => {
  const head = `import { route } from './route.mjs';

test('a pasted truedone.pages.dev or github.com link is routed', () => {
  assert.equal(route('github.com/o/r'), 'github');
  assert.equal(route('truedone.pages.dev/why'), 'site');
  assert.equal(route('truedone.pages.dev/mgillr/truedone/pull/52'), 'site');
});
`;
  const f = staticFindings({ files: [{ path: 'test/route.test.mjs', base: BASE, head }] });
  assert.equal(f.reasons.some((r) => r.check === 'deleted'), false, `no deletion: ${JSON.stringify(f.reasons)}`);
  const unrun = f.reasons.find((r) => r.check === 'unrun' && r.file === 'test/route.test.mjs');
  assert.ok(unrun, 'the removed test reads as moved');
  assert.equal(unrun.verdict, 'unrun');
});

test('a removal with no equivalent replacement stays deleted', () => {
  const head = `import { route } from './route.mjs';\n`;
  const f = staticFindings({ files: [{ path: 'test/route.test.mjs', base: BASE, head }] });
  const deleted = f.reasons.find((r) => r.check === 'deleted');
  assert.ok(deleted, 'the true removal is still found');
  assert.equal(deleted.verdict, 'tampered');
});

test('a replacement with fewer assertions does not count as the equivalent', () => {
  const head = `import { route } from './route.mjs';

test('a pasted truedone.pages.dev link is routed', () => {
  assert.equal(route('truedone.pages.dev/why'), 'site');
});
`;
  const f = staticFindings({ files: [{ path: 'test/route.test.mjs', base: BASE, head }] });
  const deleted = f.reasons.find((r) => r.check === 'deleted');
  assert.ok(deleted, 'the weaker replacement does not cover the removed test');
  assert.equal(deleted.verdict, 'tampered');
});
