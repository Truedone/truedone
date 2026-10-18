// CORE-11-AC01: a replaced test's unrun reason names its file once and no
// test name. Red on main: the reason read the test's name where the file
// belongs, so the page prefixed a file onto a test name.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { staticFindings } from '../src/checks.mjs';

const BASE = `import { route } from './route.mjs';

test('a pasted github.com or truedone.dev link is routed', () => {
  assert.equal(route('github.com/o/r'), 'github');
  assert.equal(route('truedone.dev/why'), 'site');
});
`;

const HEAD = `import { route } from './route.mjs';

test('a pasted truedone.pages.dev or github.com link is routed', () => {
  assert.equal(route('github.com/o/r'), 'github');
  assert.equal(route('truedone.pages.dev/why'), 'site');
  assert.equal(route('truedone.pages.dev/mgillr/truedone/pull/52'), 'site');
});
`;

const FILE = 'test/route.test.mjs';

test("a replaced test's unrun reason names its file once and no test name", () => {
  const f = staticFindings({ files: [{ path: FILE, base: BASE, head: HEAD }] });
  const unrun = f.reasons.find((r) => r.check === 'unrun' && r.file === FILE);
  assert.ok(unrun, 'the replaced test reads as moved');
  assert.equal(unrun.file, FILE);
  const hits = unrun.message.split(FILE).length - 1;
  assert.equal(hits, 1, `the message names the file exactly once: ${unrun.message}`);
  assert.equal(unrun.message.includes('a pasted'), false, 'the message carries no test name');
});
