// MET-01: against a fake GitHub the collector writes every figure with its window, source and sample size, lists each
// metric with no public source as not yet measured (never a zero), and the checker refuses a figure that lacks any of the
// three or a number under a not-yet-measured name. The fake answers from tools/test/fixtures/metrics/github.json by URL;
// a URL it does not know is an error, so an unplanned request fails the test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { collect, median, args, NOT_YET_MEASURED, SCHEMA, RESPONSE_SAMPLE } from '../metrics/collect.mjs';
import { problems } from '../metrics/check.mjs';

const fixture = JSON.parse(fs.readFileSync(new URL('./fixtures/metrics/github.json', import.meta.url), 'utf8'));
const NOW = new Date('2026-10-12T12:00:00Z');
const node = process.execPath;
const root = fileURLToPathDir();
function fileURLToPathDir() { return path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..'); }

function fakeGitHub(data = fixture) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push(url);
    assert.equal(init.headers.accept, 'application/vnd.github+json');
    assert.ok(!init.headers.authorization, 'no token is sent when the environment has none');
    if (!Object.hasOwn(data, url)) throw new Error(`fake GitHub: no route for ${url}`);
    return new Response(JSON.stringify(data[url]), { status: 200 });
  };
  return { fetch, calls };
}

test('the snapshot carries every figure with its window, source and sample size, and the counts are the fixture\'s', async () => {
  const gh = fakeGitHub();
  const s = await collect({ org: 'Example', fetch: gh.fetch, token: null, now: NOW });
  assert.equal(s.schema, SCHEMA);
  assert.equal(s.generated_at, NOW.toISOString());
  for (const [name, f] of Object.entries(s.figures)) {
    assert.ok(typeof f.value === 'number' || f.value === null, `${name} has a value`);
    assert.ok((f.window.from && f.window.to) || f.window.at, `${name} has a window`);
    assert.match(f.source, /^https:\/\//, `${name} has a source`);
    assert.ok(Number.isInteger(f.n) && f.n >= 0, `${name} has a sample size`);
  }
  // the archived repository is left out
  assert.equal(s.figures.public_repositories.value, 2);
  assert.equal(s.figures.stars_total.value, 13);
  assert.equal(s.figures.forks_total.value, 3);
  assert.equal(s.figures.repositories_pushed_in_window.value, 1);
  assert.equal(s.figures.releases_in_window.value, 1);
  // completed runs in the window: success, failure, cancelled; the running one and the September one are not counted
  assert.equal(s.figures.workflow_runs_in_window.value, 3);
  assert.deepEqual([s.figures.workflow_runs_success.value, s.figures.workflow_runs_failure.value, s.figures.workflow_runs_cancelled.value], [1, 1, 1]);
  assert.equal(s.figures.workflow_success_rate.value, 0.333);
  assert.equal(s.figures.workflow_success_rate.n, 3);
  assert.equal(s.figures.open_issues.value, 2);
  assert.equal(s.figures.open_pull_requests.value, 1);
  assert.equal(s.figures.issues_opened_in_window.value, 3);
  assert.equal(s.figures.pull_requests_opened_in_window.value, 1);
  // issues 7 (2 h) and 5 (6 h) have comments in the window: the median is 4 h over a sample of 2
  assert.equal(s.figures.median_hours_to_first_issue_response.value, 4);
  assert.equal(s.figures.median_hours_to_first_issue_response.n, 2);
  assert.deepEqual(s.figures.workflow_runs_in_window.window, { from: '2026-09-12T12:00:00.000Z', to: NOW.toISOString(), days: 30 });
  assert.equal(s.repositories.length, 2);
  assert.ok(gh.calls.every((u) => u.startsWith('https://api.github.com/')));
  assert.equal(gh.calls.filter((u) => u.includes('/comments')).length, 2, 'one comments read per sampled issue');
});

test('every metric with no public source is listed as not yet measured with a reason, never as a zero', async () => {
  const gh = fakeGitHub();
  const s = await collect({ org: 'Example', fetch: gh.fetch, token: null, now: NOW });
  const names = s.not_yet_measured.map((x) => x.name);
  for (const n of ['repositories_running_truedone', 'pull_requests_checked', 'faults_caught_beyond_ci', 'false_alarm_rate', 'retention_30d', 'weekly_growth']) assert.ok(names.includes(n), n);
  for (const x of s.not_yet_measured) { assert.ok(x.reason.length > 10, `${x.name} has a reason`); assert.ok(!Object.hasOwn(s.figures, x.name), `${x.name} carries no figure`); }
  assert.deepEqual(s.not_yet_measured, NOT_YET_MEASURED);
  assert.deepEqual(problems(s), []);
});

test('a null figure is allowed only with an empty sample, and the sample of first responses is capped', async () => {
  const data = { ...fixture };
  const issues = 'https://api.github.com/repos/Example/one/issues?state=all&per_page=100&sort=created&direction=desc';
  data[issues] = Array.from({ length: 15 }, (_, i) => ({ number: 100 + i, state: 'open', created_at: '2026-10-11T08:00:00Z', comments: 1 }));
  for (let i = 0; i < RESPONSE_SAMPLE; i++) data[`https://api.github.com/repos/Example/one/issues/${100 + i}/comments?per_page=1`] = [{ created_at: '2026-10-11T09:00:00Z' }];
  const gh = fakeGitHub(data);
  const s = await collect({ org: 'Example', fetch: gh.fetch, token: null, now: NOW });
  assert.equal(s.figures.median_hours_to_first_issue_response.n, RESPONSE_SAMPLE);
  assert.equal(gh.calls.filter((u) => u.includes('/comments')).length, RESPONSE_SAMPLE);
  const none = { ...fixture, [issues]: [] };
  const s2 = await collect({ org: 'Example', fetch: fakeGitHub(none).fetch, token: null, now: NOW });
  assert.equal(s2.figures.median_hours_to_first_issue_response.value, null);
  assert.equal(s2.figures.median_hours_to_first_issue_response.n, 0);
  assert.deepEqual(problems(s2), []);
});

test('the checker refuses a figure missing its window, source or sample size, a number under a not-yet-measured name, and a wrong schema', async () => {
  const good = await collect({ org: 'Example', fetch: fakeGitHub().fetch, token: null, now: NOW });
  const copy = () => JSON.parse(JSON.stringify(good));
  let s = copy(); delete s.figures.stars_total.window;
  assert.match(problems(s).join('\n'), /stars_total: window is neither/);
  s = copy(); s.figures.stars_total.source = 'the repository list';
  assert.match(problems(s).join('\n'), /stars_total: source is not an https URL/);
  s = copy(); delete s.figures.stars_total.n;
  assert.match(problems(s).join('\n'), /stars_total: n is not a whole number/);
  s = copy(); s.figures.stars_total.value = '13';
  assert.match(problems(s).join('\n'), /stars_total: value is not a number or null/);
  s = copy(); s.figures.stars_total.value = null;
  assert.match(problems(s).join('\n'), /stars_total: a null value needs an empty sample/);
  s = copy(); s.figures.pull_requests_checked = { value: 0, window: { at: NOW.toISOString() }, source: 'https://example.com', n: 0 };
  assert.match(problems(s).join('\n'), /pull_requests_checked is listed as not yet measured and carries a figure/);
  s = copy(); s.not_yet_measured = s.not_yet_measured.filter((x) => x.name !== 'false_alarm_rate');
  assert.match(problems(s).join('\n'), /not_yet_measured lacks false_alarm_rate/);
  s = copy(); s.not_yet_measured[0] = { name: 'repositories_running_truedone' };
  assert.match(problems(s).join('\n'), /has no reason/);
  s = copy(); s.schema = 'other';
  assert.match(problems(s).join('\n'), /schema is "other"/);
  assert.deepEqual(problems(copy()), []);
  assert.deepEqual(problems(null), ['the snapshot is not an object']);
});

test('the command line writes the file and the checker reads it back, and a bad file exits 1', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'metrics-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const good = await collect({ org: 'Example', fetch: fakeGitHub().fetch, token: null, now: NOW });
  fs.writeFileSync(path.join(dir, 'ok.json'), JSON.stringify(good));
  const ok = execFileSync(node, [path.join(root, 'tools/metrics/check.mjs'), path.join(dir, 'ok.json')], { encoding: 'utf8' });
  assert.match(ok, /15 figures, each with a window, a source and a sample size; 8 not yet measured/);
  fs.writeFileSync(path.join(dir, 'bad.json'), JSON.stringify({ ...good, figures: { x: { value: 1 } } }));
  assert.throws(() => execFileSync(node, [path.join(root, 'tools/metrics/check.mjs'), path.join(dir, 'bad.json')], { encoding: 'utf8', stdio: 'pipe' }), (e) => e.status === 1 && /x: window is neither/.test(e.stderr));
  assert.deepEqual(args(['--org', 'Example', '--out', 'x.json']), { org: 'Example', out: 'x.json' });
  assert.throws(() => args(['--org', 'Example']), /usage/);
  assert.throws(() => args(['--bogus']), /unknown argument/);
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.equal(median([]), null);
});
