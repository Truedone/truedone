// APP-29: the red-green stage finds the truedone step the default branch pins in the workflows at the branch's head
// commit (PV-A06). Until APP-29 defaultStepSha read each workflow at https://raw.githubusercontent.com/<owner>/<repo>/<branch
// name>/<path>, which a cache answers for up to 300 s (cache-control: max-age=300, measured 2026-10-19), so for five
// minutes after the step was added or its pin moved the App could read the old file and refuse a good report as
// proved_step; on sandbox #746 the production App left truedone: unrun that way. Here GitHub answers in its own shapes (a
// git ref, a contents listing and a raw file as GitHub answered them for Truedone/truedone-sandbox on 2026-10-19), and the
// branch's raw address still serves the old workflow while the head commit's address serves the new one:
// - the default branch's head commit comes from its git ref, and the listing and every workflow file are read at that sha;
// - a step just added there is found, and a report proving it is believed;
// - a pin just moved there is the new pin, so a report proving it is believed and one proving the old pin is refused;
// - no request is ever made to a branch-named raw address.
import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.mjs";
import { LABELS } from "../src/labels.mjs";
import { fakeGitHub, writeRoutes, pkcs1Pem, flagsDB, memoryKV, checkRuns, labelWrites, rawCalls, storedZip, compareRoute } from "./lib/github.mjs";

const KEY = await pkcs1Pem();
const BASE = "cccccccccccccccccccccccccccccccccccccccc";
const HEAD = "dddddddddddddddddddddddddddddddddddddddd";
// the default branch's head commit, and the pins before and after the move
const MAIN = "6c2eac62418533b8309d9e933ad9897c055ae053";
const NEW = "a1b2c3d4e5a1b2c3d4e5a1b2c3d4e5a1b2c3d4e5";
const OLD = "5a4b3c2d1e5a4b3c2d1e5a4b3c2d1e5a4b3c2d1e";
const REPO = { id: 7, name: "r", full_name: "o/r", owner: { login: "o" } };
const API = "https://api.github.com";
const RAW = "https://raw.githubusercontent.com";

const TEST_BEFORE = `import { test } from 'node:test';\nimport assert from 'node:assert/strict';\ntest('a', () => {\n  assert.equal(f(), 1);\n});\n`;
const TEST_AFTER = `${TEST_BEFORE}test('a again', () => {\n  assert.equal(f(), 1);\n});\n`;
const report = (provedStep) => JSON.stringify({
  schema: "truedone.report/1", head_sha: HEAD, proved_step: provedStep,
  tests: [{ name: "a again", file: "test/a.test.js", condition: "lines", base: ["fail:assertion"], head: ["pass", "pass", "pass"] }],
});
const workflow = (uses) => `name: test\non:\n  pull_request:\npermissions:\n  contents: read\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2\n${uses}      - run: npm test\n`;

// GitHub's answer to GET /repos/{owner}/{repo}/git/ref/heads/{branch}
const gitRef = (branch, sha) => ({
  ref: `refs/heads/${branch}`,
  node_id: "REF_kwDOVNltTq9yZWZzL2hlYWRzL21haW4",
  url: `${API}/repos/o/r/git/refs/heads/${branch}`,
  object: { sha, type: "commit", url: `${API}/repos/o/r/git/commits/${sha}` },
});
// GitHub's answer to GET /repos/{owner}/{repo}/contents/.github/workflows?ref={ref}, one entry per file; the route
// answers the default branch's name and its head commit, and any other ref is a 404, as GitHub answers a ref it lacks
const listing = (u) => {
  const ref = new URL(u).searchParams.get("ref");
  if (ref !== "main" && ref !== MAIN) return Response.json({ message: `No commit found for the ref ${ref}`, status: "404" }, { status: 404 });
  const path = ".github/workflows/ci.yml";
  const blob = "14d2eedbf78f039b753e43d3455a7b0a2c53dd39";
  const self = `${API}/repos/o/r/contents/${path}?ref=${ref}`;
  return Response.json([{
    name: "ci.yml", path, sha: blob, size: 400, url: self,
    html_url: `https://github.com/o/r/blob/${ref}/${path}`,
    git_url: `${API}/repos/o/r/git/blobs/${blob}`,
    download_url: `${RAW}/o/r/${ref}/${path}`,
    type: "file",
    _links: { self, git: `${API}/repos/o/r/git/blobs/${blob}`, html: `https://github.com/o/r/blob/${ref}/${path}` },
  }]);
};

// GitHub for o/r's workflow run 77 on HEAD, pull request 41: the default branch main is at MAIN; its raw address still
// serves the workflow before the change (stale) and MAIN's address the workflow after it (fresh); the run's artifact
// holds a report naming provedStep; Truedone/truedone-action has no tags, so only the default branch's step can match
function github({ stale, fresh, provedStep }) {
  const pr41 = { number: 41, state: "open", title: "t", body: "", user: { login: "someone", type: "User" }, changed_files: 1,
    head: { sha: HEAD, ref: "branch", repo: REPO }, base: { sha: BASE, ref: "main", repo: REPO } };
  return fakeGitHub({
    api: {
      "POST /app/installations/3/access_tokens": { token: "tok" },
      [`GET /repos/o/r/commits/${HEAD}/pulls`]: [pr41],
      "GET /repos/o/r/pulls/41/files": [{ filename: "test/a.test.js", status: "modified", patch: "@@ -1,1 +1,1 @@" }],
      "GET /repos/o/r/actions/runs/77/jobs": { total_count: 1, jobs: [{ id: 1, name: "test", status: "completed", conclusion: "success" }] },
      "GET /repos/o/r/actions/runs/77/artifacts": { total_count: 1, artifacts: [{ id: 9, name: "truedone-report-test", expired: false, size_in_bytes: 400, archive_download_url: `${API}/repos/o/r/actions/artifacts/9/zip` }] },
      "GET /repos/o/r/actions/artifacts/9/zip": () => new Response(storedZip(report(provedStep))),
      "GET /repos/o/r": { ...REPO, private: false, default_branch: "main" },
      "GET /repos/o/r/git/ref/heads/main": gitRef("main", MAIN),
      "GET /repos/o/r/contents/.github/workflows": listing,
      "GET /repos/Truedone/truedone-action/tags": [],
      ...compareRoute("o", "r", BASE, HEAD),
      ...writeRoutes("o", "r", 41, HEAD),
      "GET /repos/o/r/labels": LABELS.map((l) => ({ name: l.name })),
    },
    raw: {
      [`o/r/${BASE}/test/a.test.js`]: TEST_BEFORE,
      [`o/r/${HEAD}/test/a.test.js`]: TEST_AFTER,
      "o/r/main/.github/workflows/ci.yml": workflow(stale),
      [`o/r/${MAIN}/.github/workflows/ci.yml`]: workflow(fresh),
    },
  });
}

const ORIGINAL_FETCH = globalThis.fetch;
// one workflow_run delivery through the Worker's queue consumer, with a fresh Worker env
async function run(t, fake) {
  globalThis.fetch = fake;
  t.after(() => { globalThis.fetch = ORIGINAL_FETCH; });
  const lines = [];
  t.mock.method(console, "log", (...args) => { lines.push(args.map(String).join(" ")); });
  t.mock.method(console, "error", (...args) => { lines.push(args.map(String).join(" ")); });
  const env = { WEBHOOK_SECRET: "s", APP_ID: "12345", PRIVATE_KEY: KEY, KV: memoryKV(), FLAGS: flagsDB({ posting_enabled: "on" }), VERSION: "v", QUEUE: { async send() {} } };
  const m = { body: {
    event: "workflow_run", delivery: "d-run",
    payload: { action: "completed", installation: { id: 3 }, repository: { id: 7, name: "r", owner: { login: "o" } },
      workflow_run: { id: 77, head_sha: HEAD, head_repository: { full_name: "o/r" }, conclusion: "success", jobs_url: `${API}/repos/o/r/actions/runs/77/jobs` } },
  }, attempts: 1, acked: 0, retried: 0, ack() { this.acked += 1; }, retry() { this.retried += 1; } };
  await worker.queue({ queue: "truedone-dev", messages: [m] }, env);
  t.mock.reset();
  assert.deepEqual([m.acked, m.retried], [1, 0], `acknowledged once: ${lines.join(" | ")}`);
  return { lines: lines.map((l) => JSON.parse(l)), checks: checkRuns(fake).length, labels: labelWrites(fake, 41).length, urls: fake.calls.map((c) => c.url), raw: rawCalls(fake) };
}
const believed = (r) => {
  assert.deepEqual(r.lines, [], "no line logged");
  assert.deepEqual([r.checks, r.labels], [1, 1], `the check run and the label are written: ${r.urls.join(" | ")}`);
};
const refused = (r) => {
  assert.deepEqual(r.lines, [{ stage: "red-green", delivery: "d-run", repository: 7, pr: 41, refused: "proved_step" }]);
  assert.deepEqual([r.checks, r.labels], [0, 0], "nothing is written");
};
// the step's reads, in the order made: the repository, the branch's git ref, the listing and the workflow file
const stepReads = (r) => r.urls.filter((u) => /^https:\/\/api\.github\.com\/repos\/o\/r(\/git\/ref\/|\/contents\/\.github\/workflows|$)/.test(u) || (u.startsWith(`${RAW}/o/r/`) && u.includes("/.github/workflows/")));
const noBranchRaw = (r) => assert.deepEqual(r.raw.filter((u) => !u.startsWith(`o/r/${BASE}/`) && !u.startsWith(`o/r/${HEAD}/`) && !u.startsWith(`o/r/${MAIN}/`)), [], "every raw read names a commit, never the branch");

test("a step just added on the default branch is read at its head commit, so a report proving it is believed while the branch's raw address still serves the old file", async (t) => {
  const r = await run(t, github({ stale: "", fresh: `      - uses: Truedone/truedone-action@${NEW} # v1\n`, provedStep: NEW }));
  believed(r);
  assert.deepEqual(stepReads(r), [
    `${API}/repos/o/r`,
    `${API}/repos/o/r/git/ref/heads/main`,
    `${API}/repos/o/r/contents/.github/workflows?ref=${MAIN}`,
    `${RAW}/o/r/${MAIN}/.github/workflows/ci.yml`,
  ]);
  noBranchRaw(r);
});

test("a pin just moved on the default branch is read as the new pin: a report proving it is believed, and one proving the old pin is refused", async (t) => {
  const moved = { stale: `      - uses: Truedone/truedone-action@${OLD} # v1\n`, fresh: `      - uses: Truedone/truedone-action@${NEW} # v1\n` };
  const now = await run(t, github({ ...moved, provedStep: NEW }));
  believed(now);
  noBranchRaw(now);
  const before = await run(t, github({ ...moved, provedStep: OLD }));
  refused(before);
  noBranchRaw(before);
});
