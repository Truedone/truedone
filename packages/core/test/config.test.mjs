import assert from 'node:assert/strict';
import test from 'node:test';

test('the five keys, defaults, unknown keys and refused shapes', async () => {
  let readConfig;
  try {
    ({ readConfig } = await import('../src/config.mjs'));
  } catch (e) {
    assert.fail(String(e.message));
  }
  const empty = readConfig('');
  assert.deepEqual(empty.reasons, []);
  assert.equal(empty.config.test, null);
  assert.equal(empty.config.comments, 'off');
  assert.equal(empty.config.conclusion, 'neutral');
  assert.equal(empty.config.enabled, true);
  assert.deepEqual(empty.config.ignore, []);

  const set = readConfig('test: npm test {files}\ncomments: on\nconclusion: fail-on-tampered\nignore: docs/**, *.md\nenabled: false\n');
  assert.equal(set.config.test, 'npm test {files}');
  assert.equal(set.config.comments, 'on');
  assert.equal(set.config.conclusion, 'fail-on-tampered');
  assert.equal(set.config.enabled, false);
  assert.deepEqual(set.config.ignore, ['docs/**', '*.md']);

  const odd = readConfig('colour: blue\ncomments: maybe\nenabled: yes\n  nested: 1\ntest: |\nalias: *name\n');
  assert.equal(odd.config.comments, 'off');
  assert.equal(odd.config.enabled, true);
  assert.equal(odd.config.test, null);
  assert.ok(odd.reasons.some((r) => r.includes('colour')));
  assert.ok(odd.reasons.some((r) => r.includes('comments')));
  assert.ok(odd.reasons.some((r) => r.includes('nested')));
  assert.ok(odd.reasons.some((r) => r.includes('test')));
  assert.ok(odd.reasons.some((r) => r.includes('alias')));
});
