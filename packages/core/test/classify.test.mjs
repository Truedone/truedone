import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { classify } from '../src/classify.mjs';

const rows = JSON.parse(readFileSync(new URL('./fixtures/classify.json', import.meta.url), 'utf8'));
const classes = ['truedone_config', 'workflow', 'runner_config', 'setup', 'test', 'test_helper', 'lockfile', 'dependency_manifest', 'docs', 'source'];

test('fixtures cover all ten classes', () => {
  for (const name of classes) assert.ok(rows.some((row) => row.class === name), name);
});

for (const row of rows) {
  const label = row.context ? `${row.path} ${JSON.stringify(row.context.keys || row.context.configs?.[0]?.path || '')}` : row.path;
  test(`${label} is ${row.class}`, () => {
    assert.equal(classify(row.path, row.context || {}), row.class);
  });
}
