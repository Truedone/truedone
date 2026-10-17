import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyse } from '../src/analyse.mjs';
import { FILES } from '../src/limits.mjs';

test('a change past the file limit is partial and not applicable is refused', () => {
  const files = [];
  for (let i = 0; i < FILES + 1; i += 1) files.push({ path: `docs/n${i}.md`, base: 'a\n', head: 'b\n' });
  const out = analyse({ files });
  assert.equal(out.partial, true);
  assert.notEqual(out.verdict, 'not_applicable');
});

test('a language outside version 1 is not applicable and a skip marker is reported', () => {
  const out = analyse({
    files: [{ path: 'add_test.go', base: 'func TestAdd(t *testing.T) {}\n', head: 'func TestAdd(t *testing.T) { t.Skip("later") }\n' }],
  });
  assert.equal(out.verdict, 'not_applicable');
  assert.match(out.reasons.map((r) => r.message).join('\n'), /language not supported in version 1|skip or focus/i);
});
