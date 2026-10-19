// APP-31 (PV-A06): the action uploads its report as truedone-report-${GITHUB_JOB}, the job's key, and the red-green stage
// looked for truedone-report-<the jobs API's first job name>, the display name, so a job with name: or a matrix was never
// found and the stage skipped. It also took the first artifact of that name from the run, whose id a re-run keeps. Now
// the stage takes every truedone-report-* artifact of the run's latest attempt (not expired, created at or after the
// payload's run_started_at, the newest of each name), holds each to the four checks and the S6 limits, and judges them
// together. Each artifact object has the shape of GitHub's answer for sandbox #749's re-run (fixtures/artifacts/
// rerun-749.json, read on 2026-10-19: attempt 2, started 10:37:07Z, its one report created 10:37:24Z). A matrix's two
// legs carry two names here, as an action that names each leg apart would upload them.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import worker from "../src/index.mjs";
import { LABELS } from "../src/labels.mjs";
import { fakeGitHub, writeRoutes, pkcs1Pem, flagsDB, memoryKV, checkRuns, storedZip, compareRoute } from "./lib/github.mjs";

const KEY = await pkcs1Pem();
const B = "cccccccccccccccccccccccccccccccccccccccc";
const H = "dddddddddddddddddddddddddddddddddddddddd";
const STEP = "a1b2c3d4e5a1b2c3d4e5a1b2c3d4e5a1b2c3d4e5";
const REPO = { id: 7, name: "r", full_name: "o/r", owner: { login: "o" } };
const real = JSON.parse(fs.readFileSync(new URL("fixtures/artifacts/rerun-749.json", import.meta.url), "utf8")).artifacts[0];
const STARTED = "2026-10-19T10:37:07Z";
const BEFORE = "2026-10-19T10:10:30Z", AFTER = "2026-10-19T10:37:24Z";

// one artifact in GitHub's shape, its zip at the URL the answer names
let nextId = 100;
function artifact(name, { created = AFTER, size = 400, expired = false } = {}) {
  const id = nextId++;
  return { ...real, id, node_id: `ART_${id}`, name, size_in_bytes: size, expired, created_at: created, updated_at: created,
    url: `https://api.github.com/repos/o/r/actions/artifacts/${id}`, archive_download_url: `https://api.github.com/repos/o/r/actions/artifacts/${id}/zip`,
    workflow_run: { ...real.workflow_run, id: 77, head_sha: H } };
}
const report = ({ head = H, name = "a again" } = {}) => JSON.stringify({ schema: "truedone.report/1", head_sha: head, proved_step: STEP,
  tests: [{ name, file: "test/a.test.js", condition: "lines", base: ["fail:assertion"], head: ["pass", "pass", "pass"] }] });
// a stored zip whose central directory claims two entries (S6 refuses it before unzipping)
function twoFileZip(text) {
  const z = storedZip(text);
  const v = new DataView(z.buffer);
  v.setUint16(z.length - 22 + 8, 2, true); v.setUint16(z.length - 22 + 10, 2, true);
  return z;
}

const TEST_BEFORE = `import { test } from 'node:test';\nimport assert from 'node:assert/strict';\ntest('a', () => {\n  assert.equal(f(), 1);\n});\n`;
const TEST_AFTER = `${TEST_BEFORE}test('a again', () => {\n  assert.equal(f(), 1);\n});\n`;
const pull = { number: 41, state: "open", title: "t", body: "", user: { login: "someone", type: "User" }, changed_files: 1,
  head: { sha: H, ref: "branch", repo: REPO }, base: { sha: B, ref: "main", repo: REPO } };

// GitHub for run 77 on o/r#41: its jobs (display names, for the old lookup) and its artifacts, each with its zip
function github({ jobs = ["test"], artifacts = [] }) {
  const zips = Object.fromEntries(artifacts.map(([a, zip]) => [`GET /repos/o/r/actions/artifacts/${a.id}/zip`, () => new Response(zip)]));
  return fakeGitHub({
    api: {
      "POST /app/installations/3/access_tokens": { token: "tok" },
      [`GET /repos/o/r/commits/${H}/pulls`]: [pull],
      "GET /repos/o/r/pulls/41/files": [{ filename: "test/a.test.js", status: "modified", patch: "@@ -1,1 +1,1 @@" }],
      "GET /repos/o/r/actions/runs/77/jobs": { total_count: jobs.length, jobs: jobs.map((name, i) => ({ id: i + 1, run_id: 77, run_attempt: 2, name, status: "completed", conclusion: "success" })) },
      "GET /repos/o/r/actions/runs/77/artifacts": { total_count: artifacts.length, artifacts: artifacts.map(([a]) => a) },
      ...zips,
      "GET /repos/o/r": { ...REPO, private: false, default_branch: "main" },
      "GET /repos/o/r/git/ref/heads/main": { ref: "refs/heads/main", object: { sha: B, type: "commit" } },
      "GET /repos/o/r/contents/.github/workflows": [{ name: "ci.yml", path: ".github/workflows/ci.yml", type: "file" }],
      "GET /repos/Truedone/truedone-action/tags": [],
      ...compareRoute("o", "r", B, H),
      ...writeRoutes("o", "r", 41, H),
      "GET /repos/o/r/labels": LABELS.map((l) => ({ name: l.name })),
    },
    raw: {
      [`o/r/${B}/test/a.test.js`]: TEST_BEFORE,
      [`o/r/${H}/test/a.test.js`]: TEST_AFTER,
      [`o/r/${B}/.github/workflows/ci.yml`]: `jobs:\n  test:\n    steps:\n      - uses: Truedone/truedone-action@${STEP}\n`,
    },
  });
}

const ORIGINAL_FETCH = globalThis.fetch;
async function run(t, fake) {
  globalThis.fetch = fake;
  t.after(() => { globalThis.fetch = ORIGINAL_FETCH; });
  const lines = [];
  t.mock.method(console, "log", (...a) => { lines.push(a.map(String).join(" ")); });
  t.mock.method(console, "error", (...a) => { lines.push(a.map(String).join(" ")); });
  const env = { APP_ID: "12345", PRIVATE_KEY: KEY, KV: memoryKV(), FLAGS: flagsDB({ posting_enabled: "on" }), VERSION: "v", QUEUE: { async send() {} } };
  const m = { body: { event: "workflow_run", delivery: "d-run", payload: { action: "completed", installation: { id: 3 }, repository: { id: 7, name: "r", owner: { login: "o" } },
    workflow_run: { id: 77, head_sha: H, head_repository: { full_name: "o/r" }, conclusion: "success", jobs_url: "https://api.github.com/repos/o/r/actions/runs/77/jobs", run_attempt: 2, run_started_at: STARTED } } },
  attempts: 1, acked: 0, retried: 0, ack() { this.acked += 1; }, retry() { this.retried += 1; } };
  await worker.queue({ queue: "truedone-dev", messages: [m] }, env);
  t.mock.reset();
  const downloads = fake.calls.filter((c) => /\/actions\/artifacts\/\d+\/zip$/.test(c.url)).map((c) => Number(/artifacts\/(\d+)\/zip$/.exec(c.url)[1]));
  return { m, lines, downloads, checks: checkRuns(fake), summaries: checkRuns(fake).map((c) => JSON.parse(c.body).output.summary) };
}

test("a job with a display name: its report, named after the job's key, is found, checked and written", async (t) => {
  const a = artifact("truedone-report-test");
  const r = await run(t, github({ jobs: ["Unit tests (node)"], artifacts: [[a, storedZip(report())]] }));
  assert.deepEqual([r.m.acked, r.m.retried], [1, 0], r.lines.join(" | "));
  assert.deepEqual(r.downloads, [a.id]);
  assert.equal(r.checks.length, 1, "the check run is written");
});

test("a matrix of two, each leg named apart: both reports are checked and judged together in one check run", async (t) => {
  const a = artifact("truedone-report-test-node-20"), b = artifact("truedone-report-test-node-22");
  const r = await run(t, github({ jobs: ["test (20)", "test (22)"], artifacts: [[a, storedZip(report())], [b, storedZip(report({ name: "a again" }))]] }));
  assert.deepEqual([r.m.acked, r.m.retried], [1, 0], r.lines.join(" | "));
  assert.deepEqual(r.downloads.sort(), [a.id, b.id].sort());
  assert.equal(r.checks.length, 1, "one check run for the head");
});

test("a matrix leg whose report fails the checks refuses the delivery with its red-green line, and nothing is written", async (t) => {
  const a = artifact("truedone-report-test-node-20"), b = artifact("truedone-report-test-node-22");
  const r = await run(t, github({ jobs: ["test (20)", "test (22)"], artifacts: [[a, storedZip(report())], [b, storedZip(report({ head: B }))]] }));
  assert.deepEqual(r.lines.map((l) => JSON.parse(l)), [{ stage: "red-green", delivery: "d-run", repository: 7, pr: 41, refused: "head_sha" }]);
  assert.equal(r.checks.length, 0);
});

test("a re-run: the latest attempt's report is taken, never the earlier attempt's of the same name listed first", async (t) => {
  const old = artifact("truedone-report-test", { created: BEFORE }), now = artifact("truedone-report-test", { created: AFTER });
  const r = await run(t, github({ artifacts: [[old, storedZip(report({ head: B }))], [now, storedZip(report())]] }));
  assert.deepEqual([r.m.acked, r.m.retried], [1, 0], r.lines.join(" | "));
  assert.deepEqual(r.downloads, [now.id]);
  assert.equal(r.checks.length, 1);
  assert.deepEqual(r.lines, [], "no refusal: the earlier attempt's report is never read");
});

test("a re-run that uploaded no report gives no report, even with an earlier attempt's report on the run", async (t) => {
  const old = artifact("truedone-report-test", { created: BEFORE });
  const r = await run(t, github({ artifacts: [[old, storedZip(report())]] }));
  assert.deepEqual([r.m.acked, r.m.retried], [1, 0]);
  assert.deepEqual(r.downloads, []);
  assert.equal(r.checks.length, 0, "nothing is written");
});

test("an expired report and an artifact of another name are passed over", async (t) => {
  const gone = artifact("truedone-report-test", { expired: true }), other = artifact("coverage");
  const r = await run(t, github({ artifacts: [[gone, storedZip(report())], [other, storedZip("{}")]] }));
  assert.deepEqual(r.downloads, []);
  assert.equal(r.checks.length, 0);
});

for (const [why, b, zip] of [
  ["over the size cap, by its answer", artifact("truedone-report-lint", { size: 300 * 1024 }), storedZip(report())],
  ["holding two files", artifact("truedone-report-lint"), twoFileZip(report())],
]) {
  test(`S6 holds for each report: one ${why} beside a good one fails the delivery, and nothing is written`, async (t) => {
    const a = artifact("truedone-report-test");
    const r = await run(t, github({ artifacts: [[a, storedZip(report())], [b, zip]] }));
    assert.deepEqual([r.m.acked, r.m.retried], [0, 1], "the delivery is retried");
    assert.match(r.lines.join("\n"), /"stage":"red-green".*"error":"Error: artifact (over 262144 bytes|holds 2 files)"/);
    assert.equal(r.checks.length, 0);
  });
}
