import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { analyse } from '../src/analyse.mjs';

const pr = { title: '', body: '', author: { login: 'a', type: 'User' } };

test('a skipped test is Tampered and names the test', () => {
  const f = JSON.parse(fs.readFileSync('packages/core/test/fixtures/checks/skip_added/js.json', 'utf8'));
  const o = analyse({ files: f.files, pr, releases: [] });
  assert.equal(o.verdict, 'tampered');
  assert.equal(o.next, 'Restore an equivalent test.');
  assert.ok(o.reasons.some((r) => r.check === 'skip' && r.file === 'a.test.js' && r.message.includes('adds')));
});

test('docs only stay Not applicable when the text claims tests', () => {
  const o = analyse({
    files: [{ path: 'README.md', status: 'modified', base: 'a\n', head: 'b\n' }],
    pr: { title: '', body: 'adds tests', author: { login: 'a', type: 'User' } },
    releases: [],
  });
  assert.equal(o.verdict, 'not_applicable');
  assert.equal(o.next, 'Nothing.');
  assert.equal(o.reasons.some((r) => r.check === 'claim'), false);
});

test('a snapshot update with the truedone step removed is Tampered and keeps both lines', () => {
  const o = analyse({
    files: [
      { path: 'a.test.js.snap', status: 'modified', base: 'x\n', head: 'y\n' },
      { path: '.github/workflows/ci.yml', status: 'modified', base: 'steps:\n  - uses: mgillr/truedone-action@abc\n', head: 'steps: []\n' },
    ],
    pr,
    releases: [],
  });
  assert.equal(o.verdict, 'tampered');
  assert.ok(o.reasons.some((r) => r.check === 'snapshot'));
  assert.ok(o.reasons.some((r) => r.check === 'step'));
});

test('a partial change keeps ten lines and the partial line last', () => {
  const files = Array.from({ length: 301 }, (_, i) => ({
    path: `src/m${String(i).padStart(3, '0')}.js`,
    status: 'modified',
    patch: '@@ -1 +1 @@\n-a\n+b',
  }));
  const o = analyse({ files, pr, releases: [] });
  assert.equal(o.partial, true);
  assert.equal(o.reasons.length, 10);
  assert.equal(o.reasons[9].check, 'partial');
});
