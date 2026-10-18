#!/usr/bin/env node
// node tools/misses/tally.mjs --snapshot <metrics.json> [--out <file>] [--cases <dir>] [--repo <owner/name>] (COLLECT-01,
// D39): counts the wrong-verdict reports filed through .github/ISSUE_TEMPLATE/wrong-verdict.yml and writes the counts into
// a metrics snapshot (tools/metrics, MET-01) as figures, each with its window, its source and its sample size:
// wrong_verdict_reports (every report since the form exists), wrong_verdict_reports_confirmed (a maintainer added the
// label "confirmed"), wrong_verdict_reports_fixed (a BENCH-01 case's case.json names the issue in "issue"),
// false_alarms_confirmed and misses_confirmed (confirmed reports of a false alarm, and of a missed tamper or missed
// evidence). The false alarm rate stays under not_yet_measured: a count of reports is not a rate, which needs the number
// of verdicts given. The result is held to tools/metrics/check.mjs before it is written. GitHub reads go through an
// injectable fetch; GITHUB_TOKEN is sent when the environment has one.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { problems as snapshotProblems } from '../metrics/check.mjs';
import { parseReport, KINDS, REPO, ROOT } from './snapshot.mjs';

export const LABEL = 'wrong-verdict';
export const CONFIRMED = 'confirmed';
// the day the form was added (D39); every report since then is counted
export const SINCE = '2026-10-18T00:00:00.000Z';
export const CASES = path.join(ROOT, 'tools/test/fixtures/detect');
const MISSES = new Set(['missed_tamper', 'missed_evidence']);

// the issue numbers the benchmark's cases name
export function fixedIssues(dir = CASES) {
  const out = new Set();
  if (!fs.existsSync(dir)) return out;
  for (const d of fs.readdirSync(dir)) {
    const f = path.join(dir, d, 'case.json');
    if (!fs.existsSync(f)) continue;
    const c = JSON.parse(fs.readFileSync(f, 'utf8'));
    if (Number.isInteger(c.issue)) out.add(c.issue);
  }
  return out;
}

// every report, through the pages of the label's issues
export async function reports({ repo = REPO, fetch: fetchImpl = globalThis.fetch, token = process.env.GITHUB_TOKEN || null, api = 'https://api.github.com' } = {}) {
  const headers = { accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'user-agent': 'truedone-misses' };
  if (token) headers.authorization = `Bearer ${token}`;
  const source = `${api}/repos/${repo}/issues?labels=${LABEL}&state=all&per_page=100`;
  const items = [];
  for (let page = 1; page <= 50; page++) {
    const url = `${source}&page=${page}`;
    const res = await fetchImpl(url, { headers });
    if (!res.ok) throw Object.assign(new Error(`GitHub ${res.status} on ${url}`), { status: res.status });
    const batch = await res.json();
    items.push(...batch.filter((x) => !x.pull_request));
    if (batch.length < 100) break;
  }
  return { source, items };
}

export function counts(items, fixed) {
  let confirmed = 0, fixedN = 0, falseAlarms = 0, misses = 0;
  for (const it of items) {
    const kind = KINDS[parseReport(it.body).kind ?? ''] ?? null;
    const isConfirmed = (it.labels || []).some((l) => (typeof l === 'string' ? l : l.name) === CONFIRMED);
    if (isConfirmed) confirmed++;
    if (fixed.has(it.number)) fixedN++;
    if (isConfirmed && kind === 'false_alarm') falseAlarms++;
    if (isConfirmed && MISSES.has(kind)) misses++;
  }
  return { reports: items.length, confirmed, fixed: fixedN, false_alarms_confirmed: falseAlarms, misses_confirmed: misses };
}

// the snapshot with the report figures added; the not-yet-measured entries stay as they are
export function apply(snapshot, c, { source, casesUrl, now = new Date() }) {
  const window = { from: SINCE, to: now.toISOString() };
  const fig = (value) => ({ value, window, source, n: c.reports });
  const out = structuredClone(snapshot);
  out.figures = {
    ...out.figures,
    wrong_verdict_reports: fig(c.reports),
    wrong_verdict_reports_confirmed: fig(c.confirmed),
    wrong_verdict_reports_fixed: { ...fig(c.fixed), source: `${source} ${casesUrl}` },
    false_alarms_confirmed: fig(c.false_alarms_confirmed),
    misses_confirmed: fig(c.misses_confirmed),
  };
  return out;
}

export async function tally({ snapshot, repo = REPO, fetch: fetchImpl, token, casesDir = CASES, now = new Date() }) {
  const { source, items } = await reports({ repo, fetch: fetchImpl, token });
  const c = counts(items, fixedIssues(casesDir));
  const casesUrl = `https://github.com/${repo}/tree/main/tools/test/fixtures/detect`;
  const out = apply(snapshot, c, { source, casesUrl, now });
  const bad = snapshotProblems(out);
  if (bad.length) throw new Error(`the tallied snapshot fails its check: ${bad.join('; ')}`);
  return { snapshot: out, counts: c };
}

export function args(argv) {
  const out = { snapshot: null, out: null, cases: CASES, repo: REPO };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--snapshot') out.snapshot = argv[++i];
    else if (argv[i] === '--out') out.out = argv[++i];
    else if (argv[i] === '--cases') out.cases = argv[++i];
    else if (argv[i] === '--repo') out.repo = argv[++i];
    else throw new Error(`unknown argument ${argv[i]}`);
  }
  if (!out.snapshot) throw new Error('usage: node tools/misses/tally.mjs --snapshot <metrics.json> [--out <file>] [--cases <dir>] [--repo <owner/name>]');
  out.out = out.out ?? out.snapshot;
  return out;
}

export async function main(argv = process.argv.slice(2)) {
  const a = args(argv);
  const snapshot = JSON.parse(fs.readFileSync(a.snapshot, 'utf8'));
  const { snapshot: out, counts: c } = await tally({ snapshot, repo: a.repo, casesDir: a.cases });
  fs.writeFileSync(a.out, `${JSON.stringify(out, null, 2)}\n`);
  console.log(JSON.stringify({ ...c, out: a.out }));
}

if (process.argv[1] && fs.realpathSync(path.resolve(process.argv[1])) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  main().catch((e) => { console.error(`tally: ${e.message}`); process.exit(1); });
}
