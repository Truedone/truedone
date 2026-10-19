// COLLECT-01 (D39): over a fake GitHub, the snapshot of a filed wrong-verdict report reads the pull request at its two commits
// and writes a case with the base and head files, the configuration above the changed tests and the report's kind; a report
// without both commits is refused, and a case is never written into this repository. The tally counts reported, confirmed
// and fixed reports into a metrics snapshot with window, source and size, and leaves the false alarm rate not yet measured.
// The fake answers from tools/test/fixtures/misses/github.json by URL; a URL it does not know is an error, so an unplanned
// request fails the test. The pull request in the fixture is synthetic: no third-party code.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { snapshot, write, makeClient, parseReport, parsePrLink, problems, configsAbove, KINDS, ROOT } from '../misses/snapshot.mjs';
import { tally, counts, apply, fixedIssues, SINCE } from '../misses/tally.mjs';
import { problems as snapshotProblems } from '../metrics/check.mjs';

const FIX = fileURLToPath(new URL('./fixtures/misses/', import.meta.url));
const data = JSON.parse(fs.readFileSync(path.join(FIX, 'github.json'), 'utf8'));
const BASE = '1a2b3c4d5e6f708192a3b4c5d6e7f80910a1b2c3';
const HEAD = '9f8e7d6c5b4a39281706f5e4d3c2b1a090817263';
const NOW = new Date('2026-10-20T12:00:00Z');

function fakeGitHub() {
  const calls = [];
  const fetch = async (url, init = {}) => {
    calls.push(url);
    if (url.startsWith('https://raw.githubusercontent.com/')) {
      assert.ok(!init.headers?.authorization, 'no token is sent to raw.githubusercontent.com');
      return Object.hasOwn(data.raw, url) ? new Response(data.raw[url], { status: 200 }) : new Response('404: Not Found', { status: 404 });
    }
    assert.equal(init.headers.accept, 'application/vnd.github+json');
    if (!Object.hasOwn(data, url)) throw new Error(`fake GitHub: no route for ${url}`);
    return new Response(JSON.stringify(data[url]), { status: 200 });
  };
  return { fetch, calls };
}

test('the form body parses to its fields, and a report needs a pull request link, both commits and a kind', () => {
  const r = parseReport(data['https://api.github.com/repos/Truedone/truedone/issues/41'].body);
  assert.deepEqual({ pr: r.pr, head: r.head, base: r.base, verdict: r.verdict, reasons: r.reasons, kind: r.kind, version: r.version },
    { pr: 'https://github.com/example/widgets/pull/7', head: HEAD, base: BASE, verdict: 'proven', reasons: 'red_green', kind: 'a missed tamper', version: '0.1.0' });
  // the field ids the site's, the command line's and the App's links fill (WEB-14, AGENT-01, COLLECT-02)
  const form = fs.readFileSync(path.join(ROOT, '.github/ISSUE_TEMPLATE/wrong-verdict.yml'), 'utf8');
  assert.deepEqual([...form.matchAll(/^    id: (\S+)$/gm)].map((m) => m[1]), ['pr', 'head', 'base', 'verdict', 'reasons', 'kind', 'version', 'note']);
  assert.deepEqual(problems(r), []);
  assert.deepEqual(parsePrLink('https://truedone.pages.dev/example/widgets/pull/7?via=pr-line'), { owner: 'example', repo: 'widgets', number: 7 });
  const missing = parseReport(data['https://api.github.com/repos/Truedone/truedone/issues/42'].body);
  assert.equal(missing.base, '', 'an empty optional answer reads as empty');
  assert.equal(missing.reasons, '', 'the optional reason codes read as empty when not given');
  assert.match(problems(missing).join('\n'), /the base commit is not 40 hexadecimal characters/);
  assert.match(problems({ ...r, head: HEAD.slice(0, 12) }).join('\n'), /the head commit is not 40/);
  assert.match(problems({ ...r, kind: 'something else' }).join('\n'), /not one of the form's choices/);
  assert.deepEqual(Object.values(KINDS), ['false_alarm', 'missed_tamper', 'missed_evidence', 'wrong_class']);
});

test('the snapshot reads the pull request at the two commits and writes the case outside the repository', async () => {
  const gh = fakeGitHub();
  const snap = await snapshot({ issue: 41, client: makeClient({ fetch: gh.fetch, token: null }), now: NOW });
  // the comparison is pinned to the report's commits, never the pull request's current head
  assert.ok(gh.calls.includes(`https://api.github.com/repos/example/widgets/compare/${BASE}...${HEAD}`));
  assert.ok(!gh.calls.some((u) => u.includes('/pulls/7/files')), 'the file list comes from the pinned comparison');
  const r = snap.record;
  assert.equal(r.issue, 41);
  assert.deepEqual(r.commits, { base: BASE, head: HEAD });
  assert.equal(r.expected.outcome, 'missed_tamper');
  assert.equal(r.report.verdict, 'proven');
  assert.deepEqual(r.report.reasons, ['red_green']);
  assert.deepEqual(r.files.map((f) => `${f.status} ${f.path}`), ['modified src/total.mjs', 'modified test/total.test.mjs']);
  assert.ok(r.files.every((f) => typeof f.patch === 'string'), 'each file keeps its patch');
  // the configuration in the directories above the changed test, and nothing from a directory that is not above it
  assert.deepEqual(r.configs, ['package.json', 'test/conftest.py']);
  assert.deepEqual(Object.keys(snap.base).sort(), ['package.json', 'src/total.mjs', 'test/conftest.py', 'test/total.test.mjs']);
  assert.deepEqual(Object.keys(snap.head).sort(), ['package.json', 'src/total.mjs', 'test/conftest.py', 'test/total.test.mjs']);
  assert.match(snap.base['test/total.test.mjs'], /assert\.equal\(total\(\[40, 60\]\), 100\)/);
  assert.match(snap.head['test/total.test.mjs'], /assert\.ok\(total\(\[40, 60\]\) !== undefined\)/);
  // the current core's verdict at those commits: the weakened assertion is caught now
  assert.equal(r.truedone_now.verdict, 'tampered');
  assert.ok(r.truedone_now.reasons.some((x) => x.check === 'weakened' && x.file === 'test/total.test.mjs'));
  assert.deepEqual(r.check_runs.map((c) => `${c.name} ${c.conclusion}`), ['truedone success', 'test success']);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'td-misses-'));
  try {
    const dir = write(tmp, snap);
    assert.equal(path.basename(dir), '41-example-widgets-7');
    const back = JSON.parse(fs.readFileSync(path.join(dir, 'case.json'), 'utf8'));
    assert.deepEqual(back, r);
    assert.equal(fs.readFileSync(path.join(dir, 'base/test/total.test.mjs'), 'utf8'), snap.base['test/total.test.mjs']);
    assert.ok(fs.existsSync(path.join(dir, 'head/test/conftest.py')));
    assert.ok(!fs.existsSync(path.join(dir, 'head/packages/other/jest.config.js')));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  // another project's code never enters this repository
  assert.throws(() => write(path.join(ROOT, 'tools/test/fixtures/misses/out'), snap), /inside this repository/);
  assert.throws(() => write(ROOT, snap), /inside this repository/);
  assert.ok(!fs.existsSync(path.join(ROOT, 'tools/test/fixtures/misses/out')));
});

test('a report without both commits is refused before any pull request read', async () => {
  const gh = fakeGitHub();
  await assert.rejects(snapshot({ issue: 42, client: makeClient({ fetch: gh.fetch, token: null }), now: NOW }), /issue 42 is not a usable report: the base commit is not 40 hexadecimal characters/);
  assert.deepEqual(gh.calls, ['https://api.github.com/repos/Truedone/truedone/issues/42']);
});

test('configuration above a changed test means the runner and setup files and the manifests in its directories', () => {
  const tree = ['package.json', 'vitest.config.ts', 'pkg/a/package.json', 'pkg/a/test/x.test.mjs', 'pkg/a/jest.config.js', 'pkg/b/jest.config.js', 'pkg/a/src/y.mjs', 'pyproject.toml', 'docs/conf.py'];
  assert.deepEqual(configsAbove(tree, ['pkg/a/test/x.test.mjs']), ['package.json', 'pkg/a/jest.config.js', 'pkg/a/package.json', 'pyproject.toml', 'vitest.config.ts']);
  assert.deepEqual(configsAbove(tree, []), []);
});

test('the tally counts reported, confirmed and fixed reports into the metrics snapshot with window, source and size', async () => {
  const gh = fakeGitHub();
  const seed = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/metrics/latest.json'), 'utf8'));
  const { snapshot: out, counts: c } = await tally({ snapshot: seed, fetch: gh.fetch, token: null, casesDir: path.join(FIX, 'cases'), now: NOW });
  // four reports (the pull request in the label's list is not a report); 41, 43 and 45 confirmed; 41 named by a case
  assert.deepEqual(c, { reports: 4, confirmed: 3, fixed: 1, false_alarms_confirmed: 1, misses_confirmed: 2 });
  const f = out.figures;
  assert.equal(f.wrong_verdict_reports.value, 4);
  assert.equal(f.wrong_verdict_reports_confirmed.value, 3);
  assert.equal(f.wrong_verdict_reports_fixed.value, 1);
  assert.equal(f.false_alarms_confirmed.value, 1);
  assert.equal(f.misses_confirmed.value, 2);
  for (const k of ['wrong_verdict_reports', 'wrong_verdict_reports_confirmed', 'wrong_verdict_reports_fixed', 'false_alarms_confirmed', 'misses_confirmed']) {
    assert.deepEqual(f[k].window, { from: SINCE, to: NOW.toISOString() }, `${k} has its window`);
    assert.match(f[k].source, /^https:\/\/api\.github\.com\/repos\/Truedone\/truedone\/issues\?labels=wrong-verdict/, `${k} has its source`);
    assert.equal(f[k].n, 4, `${k} has its sample size`);
  }
  assert.match(f.wrong_verdict_reports_fixed.source, / https:\/\/github\.com\/Truedone\/truedone\/tree\/main\/tools\/test\/fixtures\/detect$/);
  // a count of reports is not a rate: the false alarm rate stays not yet measured, and the snapshot passes its check
  assert.ok(out.not_yet_measured.some((x) => x.name === 'false_alarm_rate'));
  assert.ok(!Object.hasOwn(f, 'false_alarm_rate'));
  assert.deepEqual(snapshotProblems(out), []);
  // the seed's own figures are untouched
  for (const [k, v] of Object.entries(seed.figures)) if (!['wrong_verdict_reports', 'wrong_verdict_reports_confirmed', 'wrong_verdict_reports_fixed', 'false_alarms_confirmed', 'misses_confirmed'].includes(k)) assert.deepEqual(f[k], v);
});

test('a fixed report is one a benchmark case names, and an empty tally is zero counts, not missing figures', () => {
  assert.deepEqual([...fixedIssues(path.join(FIX, 'cases'))], [41]);
  assert.deepEqual([...fixedIssues(path.join(FIX, 'no-such-dir'))], []);
  const c = counts([], new Set());
  assert.deepEqual(c, { reports: 0, confirmed: 0, fixed: 0, false_alarms_confirmed: 0, misses_confirmed: 0 });
  const seed = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/metrics/latest.json'), 'utf8'));
  const out = apply(seed, c, { source: 'https://api.github.com/repos/Truedone/truedone/issues?labels=wrong-verdict&state=all&per_page=100', casesUrl: 'https://github.com/Truedone/truedone/tree/main/tools/test/fixtures/detect', now: NOW });
  assert.equal(out.figures.wrong_verdict_reports.value, 0);
  assert.equal(out.figures.wrong_verdict_reports.n, 0);
  assert.deepEqual(snapshotProblems(out), []);
});
