import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { staticVerdict as judge } from '../src/checks.mjs';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/checks');
const want = {
  skip_added: 'tampered',
  focus_added: 'tampered',
  assertion_weakened: 'tampered',
  test_deleted_source_kept: 'tampered',
  test_deleted_source_deleted: 'review',
  test_moved: 'unrun',
  snapshot_updated: 'review',
  param_case_removed: 'review',
  timeout_raised: 'review',
  runner_config_changed: 'review',
  step_repinned_release: 'review',
  step_changed: 'tampered',
  claims_adds_tests: 'no_evidence',
  source_no_test: 'no_evidence',
  tests_changed_no_report: 'unrun',
  docs_only: 'not_applicable',
};

for (const row of Object.keys(want)) {
  for (const name of readdirSync(path.join(dir, row))) {
    test(`${row}/${name} is ${want[row]}`, () => {
      const input = JSON.parse(readFileSync(path.join(dir, row, name), 'utf8'));
      assert.equal(judge(input), want[row]);
    });
  }
}
