// SPK-02-AC01: the requirement evidence prototype (tools/spikes/requirement.mjs) ties an assertion to a stated
// criterion and leaves an assertion with no criterion untied, on the fixtures under tools/test/fixtures/requirement.
// Each fixture is a case laid out as BENCH-01's are (case.json and a head tree). The cases cover a criterion stated
// inline in the body, a body that describes the change and states none, two tests that name the criterion and expect
// the opposite outcome, criteria in a REQUIREMENTS.md beside a requirements.txt that is not read, a list under an
// acceptance heading beside a checklist that is not one, and the known false tie: a tie on shared words alone never
// compares the expected value. The run over the benchmark and sandbox cases writes the same bytes twice, keys sorted,
// with no absolute path. No test here runs a fixture's tests or uses the network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertionSide, criteriaOf, main, runAll, scoreCase, treeCase } from '../spikes/requirement.mjs';

const FIX = fileURLToPath(new URL('fixtures/requirement/', import.meta.url));
const DETECT = fileURLToPath(new URL('fixtures/detect/', import.meta.url));
const run = (name) => scoreCase(treeCase(path.join(FIX, name), 'fixture'), null);
const byName = (row) => Object.fromEntries(row.tests.map((t) => [t.name, t]));

test('a test whose name and assertion match a criterion stated in the body is tied; a test no criterion names is untied', () => {
  const row = run('stated-in-body');
  assert.deepEqual(row.criteria, [{ id: 'pr-1', source: 'pr_body', text: 'an expired token is rejected' }]);
  const t = byName(row);
  assert.equal(t['rejects an expired token'].score, 'tied');
  assert.equal(t['rejects an expired token'].criterion, 'pr-1');
  assert.equal(t['rejects an expired token'].basis, 'assertion');
  assert.deepEqual(t['rejects an expired token'].shared, ['expired', 'token']);
  assert.match(t['rejects an expired token'].reason, /^tied to pr-1: /);
  assert.equal(t['the log line carries the date'].score, 'untied');
  assert.equal(t['the log line carries the date'].finding, 'no_overlap');
  assert.equal(t['the log line carries the date'].criterion, null);
  assert.deepEqual(row.counts, { tests: 2, tied: 1, untied: 1, contradicts: 0 });
});

test('a case that states no criterion gets none, says so, and leaves its tests untied for that reason', () => {
  const row = run('no-criteria');
  assert.deepEqual(row.criteria, []);
  assert.match(row.criteria_note, /^none stated: /);
  assert.equal(row.tests.length, 1);
  assert.equal(row.tests[0].score, 'untied');
  assert.equal(row.tests[0].finding, 'no_criteria');
  // the descriptions in the benchmark's bodies are not read as criteria; only case 05 carries a marker
  for (const id of fs.readdirSync(DETECT).sort()) {
    const body = JSON.parse(fs.readFileSync(path.join(DETECT, id, 'case.json'), 'utf8')).pr.body;
    assert.equal(criteriaOf(body).length, id === '05-red-green-wrong-assertion' ? 1 : 0, `${id}: ${body}`);
  }
});

test('a test that names the criterion and expects the opposite outcome is untied as contradicting it, its assertion counting over its name', () => {
  const t = byName(run('contradicts'));
  for (const name of ['an expired token is accepted', 'an expired token is rejected']) {
    assert.equal(t[name].score, 'untied', name);
    assert.equal(t[name].finding, 'contradicts', name);
    assert.equal(t[name].expects, 'accepting', name);
    assert.equal(t[name].expects_from, 'assertion', name);
    assert.match(t[name].reason, /expects the accepting outcome where pr-1 states the refusing one/, name);
  }
  assert.equal(t['a live token is accepted'].finding, 'weak_overlap');
  assert.deepEqual(t['a live token is accepted'].shared, ['tokens']);
  assert.deepEqual(t['a live token is accepted'].assertion_shared, ['expired'], 'the field name is recorded, not counted');
});

test('REQUIREMENTS.md is read in its - ID: text form, requirements.txt is not, and a linked issue is recorded but not read', () => {
  const row = run('requirements-file');
  assert.deepEqual(row.criteria.map((c) => [c.id, c.source]), [['CHK-01', 'requirements_file'], ['CHK-02', 'requirements_file']]);
  assert.deepEqual(row.requirements_file, { path: 'REQUIREMENTS.md', changed_by_pull_request: true });
  assert.deepEqual(row.linked_issues, ['#12']);
  assert.match(row.criteria_note, /#12, whose text is not read offline/);
  const t = byName(row);
  assert.equal(t.test_empty_basket_is_refused.score, 'tied');
  assert.equal(t.test_empty_basket_is_refused.criterion, 'CHK-01');
  assert.equal(t.test_empty_basket_is_refused.basis, 'assertion');
  assert.equal(t.test_total_is_the_sum_of_the_items.score, 'tied');
  assert.equal(t.test_total_is_the_sum_of_the_items.criterion, 'CHK-02');
  assert.equal(t.test_total_is_the_sum_of_the_items.basis, 'subject');
  assert.equal(t.test_receipt_prints_a_header.score, 'untied');
});

test('each item under an acceptance heading is a criterion, and the summary and a checklist elsewhere are not', () => {
  const row = run('acceptance-section');
  assert.deepEqual(row.criteria.map((c) => c.text), ['a blank name is refused', 'a known name is found after trimming']);
  const t = byName(row);
  assert.equal(t['refuses a blank name'].score, 'tied');
  assert.equal(t['refuses a blank name'].criterion, 'pr-1');
  assert.equal(t['finds a known name with spaces around it'].score, 'tied');
  assert.equal(t['finds a known name with spaces around it'].criterion, 'pr-2');
});

test('a tie on shared words alone never compares the expected value, and says so', () => {
  const t = run('false-tie-on-value').tests[0];
  assert.equal(t.score, 'tied');
  assert.equal(t.basis, 'subject');
  assert.match(t.reason, /the expected value is not compared/);
});

test('each assertion form gives the side it expects, and a compared value gives none', () => {
  const table = JSON.parse(fs.readFileSync(path.join(FIX, 'assertions.json'), 'utf8'));
  for (const row of table) assert.equal(assertionSide(row.text), row.side, row.text);
});

test('on the benchmark and sandbox cases only the wrong-assertion test contradicts a criterion, and nothing is invented', () => {
  const rows = runAll();
  const flagged = rows.flatMap((r) => r.tests.filter((t) => t.finding === 'contradicts').map((t) => `${r.case}::${t.name}`));
  assert.deepEqual(flagged, ['05-red-green-wrong-assertion::an expired token is accepted']);
  for (const r of rows) {
    assert.equal(r.measured.invented_criteria, 0, r.case);
    assert.equal(r.measured.unlabelled, 0, r.case);
  }
  assert.ok(rows.some((r) => r.source === 'sandbox'), 'a sandbox case is run');
});

test('the data is the same bytes on two runs, with keys sorted and no absolute path', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'td-requirement-'));
  try {
    const log = console.log;
    console.log = () => {};
    try {
      main(['--out', path.join(dir, 'one.jsonl')]);
      main(['--out', path.join(dir, 'two.jsonl')]);
    } finally {
      console.log = log;
    }
    const one = fs.readFileSync(path.join(dir, 'one.jsonl'), 'utf8');
    assert.equal(one, fs.readFileSync(path.join(dir, 'two.jsonl'), 'utf8'));
    const root = fileURLToPath(new URL('../..', import.meta.url));
    assert.ok(!one.includes(root) && !one.includes(os.tmpdir()), 'no absolute path');
    const sortedKeys = (v) => (Array.isArray(v) ? v.every(sortedKeys)
      : v && typeof v === 'object' ? Object.keys(v).join() === Object.keys(v).sort().join() && Object.values(v).every(sortedKeys) : true);
    for (const line of one.trimEnd().split('\n')) assert.ok(sortedKeys(JSON.parse(line)), line.slice(0, 80));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
