// node tools/metrics/collect.mjs --org <login> --out <file> (MET-01): one JSON snapshot of an organisation's public GitHub
// signals, read without a token (GITHUB_TOKEN is used when the environment has one, as the workflow does; the anonymous
// quota is 60 requests an hour, so a run stays under about 40). Every figure carries its reporting window, its source URL
// and its sample size, and every metric with no honest public source is listed under not_yet_measured, never as a zero.
// Figures: public repositories, stars, forks, repositories pushed in the window, releases in the window, workflow runs in
// the window by conclusion and their success rate, open issues and pull requests, issues and pull requests opened in the
// window, and the median hours to the first comment on recent issues (a sample, its size recorded). tools/metrics/check.mjs
// holds a snapshot to the shape; docs/ops/metrics.md says what each figure means and does not mean. The fetch is injectable
// for tests; nothing here writes outside --out.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SCHEMA = 'truedone.metrics/1';
export const WINDOW_DAYS = 30;
export const RESPONSE_SAMPLE = 10;
// What has no public source before launch. A later task that adds a source removes the entry here and adds the figure.
export const NOT_YET_MEASURED = [
  { name: 'repositories_running_truedone', reason: 'needs installation records from the App, or an opt-in usage count; stars and forks are not adoption' },
  { name: 'active_integrations_30d', reason: 'needs the same records, over a 30 day window' },
  { name: 'pull_requests_checked', reason: 'needs a count of verdicts from the App, the action and the command line' },
  { name: 'faults_caught_beyond_ci', reason: 'needs the labelled detection benchmark (BENCH-01) and reviewed real cases' },
  { name: 'false_alarm_rate', reason: 'needs the labelled benchmark and the review gates (GATE-02, GATE-03R)' },
  { name: 'verification_success_rate', reason: 'needs the count of verdicts that completed against those that did not' },
  { name: 'retention_30d', reason: 'needs installation records over two windows' },
  { name: 'weekly_growth', reason: 'needs two weekly snapshots on the metrics-data branch' },
];

const API = 'https://api.github.com';

export function args(argv) {
  const out = { org: 'Truedone', out: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--org') out.org = argv[++i];
    else if (argv[i] === '--out') out.out = argv[++i];
    else throw new Error(`unknown argument ${argv[i]}`);
  }
  if (!out.org || !out.out) throw new Error('usage: node tools/metrics/collect.mjs --org <login> --out <file>');
  return out;
}

export function median(values) {
  const v = [...values].sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

// one GitHub read, one page; a non-2xx answer is an error with its status
export function makeReader(fetchImpl, token) {
  const headers = { accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'user-agent': 'truedone-metrics' };
  if (token) headers.authorization = `Bearer ${token}`;
  return async function read(url) {
    const res = await fetchImpl(url, { headers });
    if (!res.ok) throw Object.assign(new Error(`GitHub ${res.status} on ${url}`), { status: res.status });
    return res.json();
  };
}

const figure = (value, window, source, n) => ({ value, window, source, n });

export async function collect({ org, fetch: fetchImpl = globalThis.fetch, token = process.env.GITHUB_TOKEN || null, now = new Date(), api = API } = {}) {
  const read = makeReader(fetchImpl, token);
  const to = now.toISOString();
  const from = new Date(now.getTime() - WINDOW_DAYS * 86400e3).toISOString();
  const window = { from, to, days: WINDOW_DAYS };
  const inWindow = (iso) => iso && iso >= from && iso <= to;
  const reposUrl = `${api}/orgs/${org}/repos?type=public&per_page=100`;
  const repos = (await read(reposUrl)).filter((r) => !r.archived);
  const rows = [];
  const runs = { total: 0, success: 0, failure: 0, cancelled: 0, other: 0 };
  let releases = 0;
  let openIssues = 0;
  let openPulls = 0;
  let issuesOpened = 0;
  let pullsOpened = 0;
  const responseHours = [];
  const sources = { repositories: reposUrl, runs: [], releases: [], issues: [], comments: [] };
  for (const r of repos) {
    const base = `${api}/repos/${r.full_name}`;
    const runsUrl = `${base}/actions/runs?per_page=100&created=>${from.slice(0, 10)}`;
    const relUrl = `${base}/releases?per_page=100`;
    const issUrl = `${base}/issues?state=all&per_page=100&sort=created&direction=desc`;
    sources.runs.push(runsUrl); sources.releases.push(relUrl); sources.issues.push(issUrl);
    const [runsPage, rels, issues] = await Promise.all([read(runsUrl), read(relUrl), read(issUrl)]);
    const repoRuns = { total: 0, success: 0, failure: 0, cancelled: 0, other: 0 };
    for (const run of runsPage.workflow_runs || []) {
      if (!inWindow(run.created_at) || run.status !== 'completed') continue;
      repoRuns.total += 1;
      const k = ['success', 'failure', 'cancelled'].includes(run.conclusion) ? run.conclusion : 'other';
      repoRuns[k] += 1;
    }
    for (const k of Object.keys(runs)) runs[k] += repoRuns[k];
    const repoReleases = rels.filter((x) => inWindow(x.published_at)).length;
    releases += repoReleases;
    const onlyIssues = issues.filter((x) => !x.pull_request);
    const onlyPulls = issues.filter((x) => x.pull_request);
    openIssues += onlyIssues.filter((x) => x.state === 'open').length;
    openPulls += onlyPulls.filter((x) => x.state === 'open').length;
    issuesOpened += onlyIssues.filter((x) => inWindow(x.created_at)).length;
    pullsOpened += onlyPulls.filter((x) => inWindow(x.created_at)).length;
    // the first comment on each of the most recent issues of the window, at most RESPONSE_SAMPLE a repository
    const sample = onlyIssues.filter((x) => inWindow(x.created_at) && x.comments > 0).slice(0, RESPONSE_SAMPLE);
    for (const issue of sample) {
      const cUrl = `${base}/issues/${issue.number}/comments?per_page=1`;
      sources.comments.push(cUrl);
      const [first] = await read(cUrl);
      if (first) responseHours.push((Date.parse(first.created_at) - Date.parse(issue.created_at)) / 3600e3);
    }
    rows.push({
      repository: r.full_name, url: r.html_url, stars: r.stargazers_count, forks: r.forks_count, pushed_at: r.pushed_at,
      pushed_in_window: inWindow(r.pushed_at), releases_in_window: repoReleases, workflow_runs_in_window: repoRuns,
      open_issues: onlyIssues.filter((x) => x.state === 'open').length, open_pull_requests: onlyPulls.filter((x) => x.state === 'open').length,
    });
  }
  const now_ = { at: to };
  const n = repos.length;
  const figures = {
    public_repositories: figure(n, now_, reposUrl, n),
    stars_total: figure(repos.reduce((s, r) => s + r.stargazers_count, 0), now_, reposUrl, n),
    forks_total: figure(repos.reduce((s, r) => s + r.forks_count, 0), now_, reposUrl, n),
    repositories_pushed_in_window: figure(rows.filter((x) => x.pushed_in_window).length, window, reposUrl, n),
    releases_in_window: figure(releases, window, sources.releases.join(' '), n),
    workflow_runs_in_window: figure(runs.total, window, sources.runs.join(' '), n),
    workflow_runs_success: figure(runs.success, window, sources.runs.join(' '), runs.total),
    workflow_runs_failure: figure(runs.failure, window, sources.runs.join(' '), runs.total),
    workflow_runs_cancelled: figure(runs.cancelled, window, sources.runs.join(' '), runs.total),
    workflow_success_rate: figure(runs.total ? Math.round((runs.success / runs.total) * 1000) / 1000 : null, window, sources.runs.join(' '), runs.total),
    open_issues: figure(openIssues, now_, sources.issues.join(' '), n),
    open_pull_requests: figure(openPulls, now_, sources.issues.join(' '), n),
    issues_opened_in_window: figure(issuesOpened, window, sources.issues.join(' '), n),
    pull_requests_opened_in_window: figure(pullsOpened, window, sources.issues.join(' '), n),
    median_hours_to_first_issue_response: figure(responseHours.length ? Math.round(median(responseHours) * 100) / 100 : null, window, sources.comments.join(' ') || sources.issues.join(' '), responseHours.length),
  };
  return {
    schema: SCHEMA, generated_at: to, organisation: org, window, figures, not_yet_measured: NOT_YET_MEASURED, repositories: rows,
    reading: 'Public GitHub metadata only. Stars, forks and activity are visibility, not adoption; a workflow run is this organisation\'s CI, not a user\'s. The metrics under not_yet_measured have no honest public source yet and are not shown as zero.',
  };
}

export async function main(argv = process.argv.slice(2)) {
  const a = args(argv);
  const snapshot = await collect({ org: a.org });
  fs.mkdirSync(path.dirname(path.resolve(a.out)), { recursive: true });
  fs.writeFileSync(a.out, `${JSON.stringify(snapshot, null, 2)}\n`);
  const f = snapshot.figures;
  console.log(JSON.stringify({ organisation: a.org, public_repositories: f.public_repositories.value, workflow_runs_in_window: f.workflow_runs_in_window.value, workflow_success_rate: f.workflow_success_rate.value, not_yet_measured: snapshot.not_yet_measured.length, out: a.out }));
}

if (process.argv[1] && fs.realpathSync(path.resolve(process.argv[1])) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  main().catch((e) => { console.error(e.message); process.exit(1); });
}
