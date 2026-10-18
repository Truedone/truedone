// ORG-02: the profile generator writes the eight headline rows with figure, window, source and sample size, writes Not yet
// measured with the reason where the snapshot has no source, and its check refuses a page over 60 lines, a bare number, a
// banned word, an em dash, and a page that differs from its output. The snapshot comes from the collector run against the
// metrics fixture, so the figures are the fixture's.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { collect } from '../metrics/collect.mjs';
import { generate, problems, HEADLINE, HEADER, BANNED, MAX_LINES } from '../org-profile.mjs';

const fixture = JSON.parse(fs.readFileSync(new URL('./fixtures/metrics/github.json', import.meta.url), 'utf8'));
const NOW = new Date('2026-10-12T12:00:00Z');
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const node = process.execPath;
const snapshot = await collect({ org: 'Example', fetch: async (url) => new Response(JSON.stringify(fixture[url]), { status: 200 }), token: null, now: NOW });
const rows = (page) => { const l = page.split('\n'); const i = l.indexOf(HEADER); const out = []; for (let j = i + 2; l[j] && l[j].startsWith('|'); j++) out.push(l[j]); return out; };
const cells = (row) => row.split('|').slice(1, -1).map((c) => c.trim());

test('the page has the name, a value sentence under 25 words, a way to try it, and eight headline rows', () => {
  const page = generate(snapshot);
  const lines = page.split('\n');
  assert.equal(lines[0], '# Truedone');
  assert.ok(lines[2].split(/\s+/).length <= 25);
  assert.ok(lines[4].includes('truedone.pages.dev'));
  const head = rows(page);
  assert.equal(head.length, HEADLINE.length);
  assert.deepEqual(head.map((r) => cells(r)[0]), HEADLINE.map(([label]) => label));
  assert.ok(lines.length - 1 <= MAX_LINES, `${lines.length - 1} lines`);
  assert.deepEqual(problems(page, snapshot), []);
});

test('a headline metric with no source reads Not yet measured with its reason, and one with a figure shows the number with window, source and sample', () => {
  const page = generate(snapshot);
  for (const r of rows(page)) {
    const [label, figure, window, source, sample] = cells(r);
    assert.equal(figure, 'Not yet measured', label);
    assert.ok(source.length > 10, `${label} carries the reason`);
    assert.equal(window, ''); assert.equal(sample, '');
  }
  const s = JSON.parse(JSON.stringify(snapshot));
  s.figures.pull_requests_checked = { value: 42, window: { from: '2026-09-12T12:00:00.000Z', to: NOW.toISOString(), days: 30 }, source: 'https://example.com/verdicts', n: 42 };
  s.not_yet_measured = s.not_yet_measured.filter((x) => x.name !== 'pull_requests_checked');
  const row = rows(generate(s)).find((r) => cells(r)[0] === 'Pull requests checked');
  assert.deepEqual(cells(row), ['Pull requests checked', '42', '2026-09-12 to 2026-10-12', '[example.com/verdicts](https://example.com/verdicts)', '42']);
  assert.deepEqual(problems(generate(s), s), []);
  // a metric the snapshot neither measures nor explains is an error, never a silent zero
  const t = JSON.parse(JSON.stringify(snapshot));
  t.not_yet_measured = t.not_yet_measured.filter((x) => x.name !== 'weekly_growth');
  assert.throws(() => generate(t), /neither measures weekly_growth nor says why not/);
});

test('the measured table shows the public figures with their windows, sources and samples, a rate as a percentage, and leaves the workflow runs off the page', () => {
  const page = generate(snapshot);
  const after = page.slice(page.indexOf('## Measured today'));
  const today = rows(after);
  assert.equal(today.length, 4);
  assert.ok(!today.some((r) => /CI|workflow/.test(cells(r)[0])), 'the sandbox fails by design, so its runs are not a figure here');
  const issues = today.find((r) => cells(r)[0] === 'Open issues');
  assert.deepEqual(cells(issues).slice(1), ['2', 'on 2026-10-12', '[api.github.com/repos/Example/one/issues](https://api.github.com/repos/Example/one/issues?state=all&per_page=100&sort=created&direction=desc) and 1 more', '2']);
  const hours = today.find((r) => cells(r)[0].startsWith('Hours to a first'));
  assert.equal(cells(hours)[1], '4 h');
  const s = JSON.parse(JSON.stringify(snapshot));
  s.figures.verification_success_rate = { value: 0.987, window: { from: '2026-09-12T12:00:00.000Z', to: NOW.toISOString(), days: 30 }, source: 'https://example.com/verdicts', n: 300 };
  s.not_yet_measured = s.not_yet_measured.filter((x) => x.name !== 'verification_success_rate');
  assert.equal(cells(rows(generate(s)).find((r) => cells(r)[0] === 'Verification success rate'))[1], '98.7%');
});

test('the check refuses a long page, a bare number, a banned word, an em dash, a non-ASCII character and a page that differs from the generator', () => {
  const page = generate(snapshot);
  const miss = (p) => problems(p, snapshot).join('\n');
  assert.match(miss(page + 'x\n'.repeat(MAX_LINES)), /lines, more than 60/);
  assert.match(miss(page.replace('| Not yet measured | | needs installation records', '| 0 | | needs installation records')), /figure without its window, source or sample/);
  assert.match(miss(page.replace('| Not yet measured | | needs the labelled detection benchmark (BENCH-01) and reviewed real cases |', '| Not yet measured | |  |')), /not yet measured without a reason/);
  for (const w of BANNED) assert.match(miss(page.replace('Nothing to install.', `A ${w} tool.`)), new RegExp(`the word ${w}`));
  assert.match(miss(page.replace('Nothing to install.', 'Nothing \u2014 to install.')), /an em or en dash/);
  assert.match(miss(page.replace('Nothing to install.', 'Nothing to install \u2713')), /outside plain ASCII/);
  assert.match(miss(page.replace('Nothing to install.', 'Nothing at all to install.')), /not what the generator writes/);
  assert.match(miss(page.replace('# Truedone', '# truedone')), /line 1 is not/);
  assert.match(miss(page.replace(/^\| Weekly growth.*\n/m, '')), /headline table has 7 rows/);
  assert.deepEqual(problems(page, snapshot), []);
});

test('the command line writes the page, --check passes it, and --check fails an edited page with exit 1', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'org-profile-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const snap = path.join(dir, 'latest.json'); const page = path.join(dir, 'README.md');
  fs.writeFileSync(snap, JSON.stringify(snapshot));
  const tool = path.join(root, 'tools/org-profile.mjs');
  assert.match(execFileSync(node, [tool, snap, page], { encoding: 'utf8' }), /written, \d+ lines/);
  assert.equal(fs.readFileSync(page, 'utf8'), generate(snapshot));
  assert.match(execFileSync(node, [tool, '--check', snap, page], { encoding: 'utf8' }), /8 headline rows, every figure sourced, equals the generator/);
  fs.appendFileSync(page, 'A powerful line.\n');
  assert.throws(() => execFileSync(node, [tool, '--check', snap, page], { encoding: 'utf8', stdio: 'pipe' }), (e) => e.status === 1 && /the word powerful/.test(e.stderr) && /not what the generator writes/.test(e.stderr));
  assert.throws(() => execFileSync(node, [tool, '--check', snap, path.join(dir, 'missing.md')], { encoding: 'utf8', stdio: 'pipe' }), (e) => e.status === 1);
});
