// MET-02: the organisation page shows the three wrong-verdict counts (D39) under Measured today, Wrong-verdict reports,
// Confirmed wrong verdicts and Fixed wrong verdicts, each a count with its window, source and sample, and shows none of
// them when the snapshot does not carry the figure. The fixture is a copy of docs/metrics/latest.json without those
// figures, plus the three figures as tools/misses/tally.mjs writes them, tallied here against a fake GitHub that answers
// five reports (three confirmed, two named by benchmark cases).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { generate, problems, HEADER, HEADLINE, MAX_LINES } from '../org-profile.mjs';
import { tally, counts, apply } from '../misses/tally.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const NOW = new Date('2026-10-20T12:00:00Z');
const NAMES = ['wrong_verdict_reports', 'wrong_verdict_reports_confirmed', 'wrong_verdict_reports_fixed'];
const LABELS = ['Wrong-verdict reports', 'Confirmed wrong verdicts', 'Fixed wrong verdicts'];
const ISSUES = 'https://api.github.com/repos/Truedone/truedone/issues?labels=wrong-verdict&state=all&per_page=100';
const CASES = 'https://github.com/Truedone/truedone/tree/main/tools/test/fixtures/detect';

// the committed snapshot without the wrong-verdict figures, whatever it carries today
const committed = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/metrics/latest.json'), 'utf8'));
const base = structuredClone(committed);
for (const k of [...NAMES, 'false_alarms_confirmed', 'misses_confirmed']) delete base.figures[k];

const report = (number, confirmed) => ({
  number,
  body: `### Pull request\n\nhttps://github.com/Example/one/pull/${number}\n\n### What is wrong\n\na false alarm\n`,
  labels: [{ name: 'wrong-verdict' }, ...(confirmed ? [{ name: 'confirmed' }] : [])],
});
const fakeGitHub = async (url) => {
  if (url !== `${ISSUES}&page=1`) throw new Error(`fake GitHub: no route for ${url}`);
  return new Response(JSON.stringify([report(201, true), report(202, true), report(203, true), report(204, false), report(205, false)]), { status: 200 });
};
const casesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'org-profile-misses-'));
for (const [id, issue] of [['a', 201], ['b', 204]]) {
  fs.mkdirSync(path.join(casesDir, id));
  fs.writeFileSync(path.join(casesDir, id, 'case.json'), JSON.stringify({ issue }));
}
const { snapshot: tallied, counts: c } = await tally({ snapshot: base, fetch: fakeGitHub, token: null, casesDir, now: NOW });
fs.rmSync(casesDir, { recursive: true, force: true });
// the copy plus the three figures, in tally's shape
const withCounts = structuredClone(base);
for (const k of NAMES) withCounts.figures[k] = tallied.figures[k];

const today = (page) => {
  const l = page.split('\n');
  const i = l.indexOf(HEADER, l.indexOf('## Measured today'));
  const out = [];
  for (let j = i + 2; l[j] && l[j].startsWith('|'); j++) out.push(l[j]);
  return out;
};
const cells = (row) => row.split('|').slice(1, -1).map((x) => x.trim());
const row = (page, label) => today(page).map(cells).find((r) => r[0] === label);

test('the three counts render under Measured today, each with its window, source and sample', () => {
  assert.deepEqual(c, { reports: 5, confirmed: 3, fixed: 2, false_alarms_confirmed: 3, misses_confirmed: 0 });
  const page = generate(withCounts);
  const source = `[api.github.com/repos/Truedone/truedone/issues](${ISSUES})`;
  assert.deepEqual(row(page, 'Wrong-verdict reports'), ['Wrong-verdict reports', '5', '2026-10-18 to 2026-10-20', source, '5']);
  assert.deepEqual(row(page, 'Confirmed wrong verdicts'), ['Confirmed wrong verdicts', '3', '2026-10-18 to 2026-10-20', source, '5']);
  assert.deepEqual(row(page, 'Fixed wrong verdicts'), ['Fixed wrong verdicts', '2', '2026-10-18 to 2026-10-20', `${source} and 1 more`, '5']);
  assert.equal(withCounts.figures.wrong_verdict_reports_fixed.source, `${ISSUES} ${CASES}`);
  // the rows are in the second table, in this order after the public figures; the headline table keeps its eight rows
  assert.deepEqual(today(page).map((r) => cells(r)[0]).slice(-3), LABELS);
  const l = page.split('\n');
  const head = [];
  for (let j = l.indexOf(HEADER) + 2; l[j].startsWith('|'); j++) head.push(cells(l[j])[0]);
  assert.deepEqual(head, HEADLINE.map(([label]) => label));
  assert.ok(page.split('\n').length - 1 <= MAX_LINES, `${page.split('\n').length - 1} lines`);
  assert.deepEqual(problems(page, withCounts), []);
});

test('no count yet is a zero over an empty sample, still with its window and source', () => {
  const zero = structuredClone(base);
  const out = apply(base, counts([], new Set()), { source: ISSUES, casesUrl: CASES, now: NOW });
  for (const k of NAMES) zero.figures[k] = out.figures[k];
  const page = generate(zero);
  for (const label of LABELS) {
    const [, figure, window, source, sample] = row(page, label);
    assert.equal(figure, '0', label);
    assert.equal(window, '2026-10-18 to 2026-10-20', label);
    assert.match(source, /^\[api\.github\.com\/repos\/Truedone\/truedone\/issues\]\(https:\/\/api\.github\.com\/repos\/Truedone\/truedone\/issues\?labels=wrong-verdict/, label);
    assert.equal(sample, '0', label);
  }
  assert.deepEqual(problems(page, zero), []);
});

test('a count the snapshot does not carry has no row, and the others still show', () => {
  const page = generate(base);
  for (const label of LABELS) assert.equal(row(page, label), undefined, `${label} is absent`);
  assert.equal(today(page).length, today(generate(withCounts)).length - 3);
  assert.deepEqual(problems(page, base), []);
  for (let i = 0; i < NAMES.length; i++) {
    const s = structuredClone(withCounts);
    delete s.figures[NAMES[i]];
    const p = generate(s);
    assert.equal(row(p, LABELS[i]), undefined, `${LABELS[i]} is absent without ${NAMES[i]}`);
    for (const other of LABELS.filter((_, j) => j !== i)) assert.ok(row(p, other), `${other} still shows`);
    assert.deepEqual(problems(p, s), []);
  }
});
