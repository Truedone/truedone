// APP-32 (S8): the red-green stage's early returns wrote nothing to the Worker log, and the queue consumer acknowledged them
// as it does a verdict, so a missed verdict looked like a success (sandbox #749's re-run at 10:37Z: the delivery and an ok
// batch, and no line at all). Each path now writes one line, {"stage": "red-green", delivery, repository, pr when known,
// skipped}, with identifiers only. Through the Worker's queue consumer, each case drives one path and reads every line:
// an action other than completed (a message queued before APP-16), no pull request for the head commit (GitHub lists a
// closed, unmerged pull request for no commit), a run held for approval, no report artifact, and a standing tampered
// verdict (the static stage's own check run stands, D10; review takes the same return).
import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.mjs";
import { LABELS } from "../src/labels.mjs";
import { fakeGitHub, writeRoutes, pkcs1Pem, flagsDB, memoryKV, checkRuns, labelWrites, storedZip, compareRoute } from "./lib/github.mjs";

const KEY = await pkcs1Pem();
const B = "cccccccccccccccccccccccccccccccccccccccc";
const H = "dddddddddddddddddddddddddddddddddddddddd";
const STEP = "a1b2c3d4e5a1b2c3d4e5a1b2c3d4e5a1b2c3d4e5";
const REPO = { id: 7, name: "r", full_name: "o/r", owner: { login: "o" } };
const LOGIN = "planted-login";
const REPORT = JSON.stringify({ schema: "truedone.report/1", head_sha: H, proved_step: STEP,
  tests: [{ name: "a", file: "test/a.test.js", condition: "lines", base: ["fail:assertion"], head: ["pass", "pass", "pass"] }] });
const TWO = `import { test } from 'node:test';\nimport assert from 'node:assert/strict';\ntest('a', () => {\n  assert.equal(f(), 1);\n  assert.equal(g(), 2);\n});\n`;
const ONE = `import { test } from 'node:test';\nimport assert from 'node:assert/strict';\ntest('a', () => {\n  assert.equal(f(), 1);\n});\n`;
const pull = { number: 41, state: "open", title: "t", body: "", user: { login: LOGIN, type: "User" }, changed_files: 1,
  head: { sha: H, ref: "branch", repo: REPO }, base: { sha: B, ref: "main", repo: REPO } };
const artifact = { id: 9, node_id: "ART_9", name: "truedone-report-test", size_in_bytes: 400, expired: false, created_at: "2026-10-19T10:37:24Z", updated_at: "2026-10-19T10:37:24Z",
  url: "https://api.github.com/repos/o/r/actions/artifacts/9", archive_download_url: "https://api.github.com/repos/o/r/actions/artifacts/9/zip", workflow_run: { id: 77, head_sha: H } };

// GitHub for run 77 on o/r#41. pulls: what the commit lists; artifacts: the run's; head: the test file at the head
function github({ pulls = [pull], artifacts = [artifact], head = TWO } = {}) {
  return fakeGitHub({
    api: {
      "POST /app/installations/3/access_tokens": { token: "tok" },
      [`GET /repos/o/r/commits/${H}/pulls`]: pulls,
      "GET /repos/o/r/pulls/41/files": [{ filename: "test/a.test.js", status: "modified", patch: "@@ -1,6 +1,5 @@" }],
      "GET /repos/o/r/actions/runs/77/artifacts": { total_count: artifacts.length, artifacts },
      "GET /repos/o/r/actions/artifacts/9/zip": () => new Response(storedZip(REPORT)),
      "GET /repos/o/r": { ...REPO, private: false, default_branch: "main" },
      "GET /repos/o/r/git/ref/heads/main": { ref: "refs/heads/main", object: { sha: B, type: "commit" } },
      "GET /repos/o/r/contents/.github/workflows": [{ name: "ci.yml", path: ".github/workflows/ci.yml", type: "file" }],
      "GET /repos/Truedone/truedone-action/tags": [],
      ...compareRoute("o", "r", B, H),
      ...writeRoutes("o", "r", 41, H),
      "GET /repos/o/r/labels": LABELS.map((l) => ({ name: l.name })),
    },
    raw: {
      [`o/r/${B}/test/a.test.js`]: TWO,
      [`o/r/${H}/test/a.test.js`]: head,
      [`o/r/${B}/.github/workflows/ci.yml`]: `jobs:\n  test:\n    steps:\n      - uses: Truedone/truedone-action@${STEP}\n`,
    },
  });
}

const ORIGINAL_FETCH = globalThis.fetch;
async function run(t, fake, { action = "completed", conclusion = "success" } = {}) {
  globalThis.fetch = fake;
  t.after(() => { globalThis.fetch = ORIGINAL_FETCH; });
  const lines = [];
  t.mock.method(console, "log", (...a) => { lines.push(a.map(String).join(" ")); });
  t.mock.method(console, "error", (...a) => { lines.push(a.map(String).join(" ")); });
  const env = { APP_ID: "12345", PRIVATE_KEY: KEY, KV: memoryKV(), FLAGS: flagsDB({ posting_enabled: "on" }), VERSION: "v", QUEUE: { async send() {} } };
  const m = { body: { event: "workflow_run", delivery: "d-run", payload: { action, installation: { id: 3 }, repository: { id: 7, name: "r", owner: { login: "o" } },
    workflow_run: { id: 77, head_sha: H, head_repository: { full_name: "o/r" }, conclusion, run_attempt: 1, run_started_at: "2026-10-19T10:30:00Z" } } },
  attempts: 1, acked: 0, retried: 0, ack() { this.acked += 1; }, retry() { this.retried += 1; } };
  await worker.queue({ queue: "truedone-dev", messages: [m] }, env);
  t.mock.reset();
  assert.deepEqual([m.acked, m.retried], [1, 0], `acknowledged once: ${lines.join(" | ")}`);
  assert.ok(!lines.join("\n").includes(LOGIN), "no login in the log");
  assert.deepEqual([checkRuns(fake).length, labelWrites(fake, 41).length], [0, 0], "nothing is written");
  return lines.map((l) => JSON.parse(l));
}
const line = (skipped, pr) => ({ stage: "red-green", delivery: "d-run", repository: 7, ...(pr ? { pr } : {}), skipped });

test("an action other than completed says so in one line", async (t) => {
  assert.deepEqual(await run(t, github(), { action: "requested" }), [line("requested")]);
});

test("no pull request for the head commit, as for a closed unmerged one, says no_pr in one line without a pull request number", async (t) => {
  assert.deepEqual(await run(t, github({ pulls: [] })), [line("no_pr")]);
});

test("a pull request from another repository's head is no pull request here, and says so", async (t) => {
  const fork = { ...pull, head: { ...pull.head, repo: { ...REPO, full_name: "f/r", owner: { login: "f" } } } };
  assert.deepEqual(await run(t, github({ pulls: [fork] })), [line("no_pr")]);
});

test("a run held for approval says action_required in one line", async (t) => {
  assert.deepEqual(await run(t, github(), { conclusion: "action_required" }), [line("action_required", 41)]);
});

test("a run with no report artifact says no_report in one line", async (t) => {
  assert.deepEqual(await run(t, github({ artifacts: [] })), [line("no_report", 41)]);
});

test("a standing tampered verdict says tampered in one line, and the report does not override it", async (t) => {
  assert.deepEqual(await run(t, github({ head: ONE })), [line("tampered", 41)]);
});
