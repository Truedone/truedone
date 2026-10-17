import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { analyse } from '../src/analyse.mjs';

const kept = JSON.parse(readFileSync(new URL('./fixtures/checks/test_deleted_source_kept/js.json', import.meta.url), 'utf8'));

function pr(login) {
  return { title: '', body: '', author: { login, type: 'Bot' } };
}

test('a Dependabot change is not applicable', () => {
  const out = analyse({ files: kept.files, pr: pr('dependabot[bot]') });
  assert.equal(out.verdict, 'not_applicable');
  assert.equal(out.label, null);
});

test('a Copilot change is checked', () => {
  const out = analyse({ files: kept.files, pr: pr('copilot[bot]') });
  assert.equal(out.verdict, 'tampered');
});

test('a Devin change is checked', () => {
  const out = analyse({ files: kept.files, pr: pr('devin-ai[bot]') });
  assert.equal(out.verdict, 'tampered');
});
