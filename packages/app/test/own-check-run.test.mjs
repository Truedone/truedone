// APP-30 (PV-A04): with two truedone Apps installed on one repository, the development App (5363933) and the production
// App (5364032) on the Truedone organisation since 2026-10-19, a head commit carries a truedone check run from each.
// checkRunFor took the first run of that name from any App, so the production App PATCHed the development App's run and
// GitHub answered 403, four times, and the delivery went to the dead-letter queue (sandbox, 10:47Z). The fixture is
// GitHub's answer for sandbox #750's head (fixtures/check-runs/two-apps.json, read without a token on 2026-10-19), which
// lists the development App's run first. Through the Worker's queue consumer, for the red-green stage and the static
// stage, each App reads only its own runs (app_id) and PATCHes only its own; an App with no run there POSTs a new one.
// Another App's run answers a PATCH with 403, as GitHub did; the status is the logged one, and the body is assumed.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import worker from "../src/index.mjs";
import { LABELS } from "../src/labels.mjs";
import { fakeGitHub, writeRoutes, pkcs1Pem, flagsDB, memoryKV, storedZip, compareRoute } from "./lib/github.mjs";

const KEY = await pkcs1Pem();
const B = "cccccccccccccccccccccccccccccccccccccccc";
const H = "dddddddddddddddddddddddddddddddddddddddd";
const STEP = "a1b2c3d4e5a1b2c3d4e5a1b2c3d4e5a1b2c3d4e5";
const REPO = { id: 7, name: "r", full_name: "o/r", owner: { login: "o" } };
const DEV = 5363933, PROD = 5364032;
const answer = JSON.parse(fs.readFileSync(new URL("fixtures/check-runs/two-apps.json", import.meta.url), "utf8"));
const runOf = (app) => answer.check_runs.find((r) => r.app.id === app).id;

const TEST_BEFORE = `import { test } from 'node:test';\nimport assert from 'node:assert/strict';\ntest('a', () => {\n  assert.equal(f(), 1);\n});\n`;
const TEST_AFTER = `${TEST_BEFORE}test('a again', () => {\n  assert.equal(f(), 1);\n});\n`;
const REPORT = JSON.stringify({ schema: "truedone.report/1", head_sha: H, proved_step: STEP,
  tests: [{ name: "a again", file: "test/a.test.js", condition: "lines", base: ["fail:assertion"], head: ["pass", "pass", "pass"] }] });
const pull = { number: 41, state: "open", title: "t", body: "", user: { login: "someone", type: "User" }, changed_files: 1,
  head: { sha: H, ref: "branch", repo: REPO }, base: { sha: B, ref: "main", repo: REPO } };

// GitHub for o/r#41 at H, with the two Apps' truedone runs on H; a PATCH of either run answers 200 only from its own App
function github(app) {
  const patch = (owner) => () => (owner === app ? Response.json({ id: runOf(owner) }) : Response.json({ message: "Resource not accessible by integration" }, { status: 403 }));
  return fakeGitHub({
    api: {
      "POST /app/installations/3/access_tokens": { token: "tok" },
      [`GET /repos/o/r/commits/${H}/pulls`]: [pull],
      "GET /repos/o/r/pulls/41": pull,
      "GET /repos/o/r/pulls/41/files": [{ filename: "test/a.test.js", status: "modified", patch: "@@ -1,1 +1,1 @@" }],
      "GET /repos/o/r/actions/runs/77/jobs": { total_count: 1, jobs: [{ id: 1, name: "test", status: "completed", conclusion: "success" }] },
      "GET /repos/o/r/actions/runs/77/artifacts": { total_count: 1, artifacts: [{ id: 9, name: "truedone-report-test", expired: false, size_in_bytes: 400, archive_download_url: "https://api.github.com/repos/o/r/actions/artifacts/9/zip" }] },
      "GET /repos/o/r/actions/artifacts/9/zip": () => new Response(storedZip(REPORT)),
      "GET /repos/o/r": { ...REPO, private: false, default_branch: "main" },
      "GET /repos/o/r/git/ref/heads/main": { ref: "refs/heads/main", object: { sha: B, type: "commit" } },
      "GET /repos/o/r/contents/.github/workflows": [{ name: "ci.yml", path: ".github/workflows/ci.yml", type: "file" }],
      "GET /repos/Truedone/truedone-action/tags": [],
      ...compareRoute("o", "r", B, H),
      ...writeRoutes("o", "r", 41, H),
      [`GET /repos/o/r/commits/${H}/check-runs`]: answer,
      [`PATCH /repos/o/r/check-runs/${runOf(DEV)}`]: patch(DEV),
      [`PATCH /repos/o/r/check-runs/${runOf(PROD)}`]: patch(PROD),
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
const MESSAGES = {
  "red-green": { event: "workflow_run", delivery: "d-run", payload: { action: "completed", installation: { id: 3 }, repository: { id: 7, name: "r", owner: { login: "o" } },
    workflow_run: { id: 77, head_sha: H, head_repository: { full_name: "o/r" }, conclusion: "success", jobs_url: "https://api.github.com/repos/o/r/actions/runs/77/jobs" } } },
  static: { event: "pull_request", delivery: "d-pr", payload: { action: "synchronize", installation: { id: 3 }, repository: { id: 7, name: "r", owner: { login: "o" } },
    pull_request: { number: 41, base: { sha: B }, head: { sha: H } } } },
};
async function consume(t, stage, app) {
  const fake = github(app);
  globalThis.fetch = fake;
  t.after(() => { globalThis.fetch = ORIGINAL_FETCH; });
  const lines = [];
  t.mock.method(console, "log", (...a) => { lines.push(a.map(String).join(" ")); });
  t.mock.method(console, "error", (...a) => { lines.push(a.map(String).join(" ")); });
  const env = { APP_ID: String(app), PRIVATE_KEY: KEY, KV: memoryKV(), FLAGS: flagsDB({ posting_enabled: "on" }), VERSION: "v", QUEUE: { async send() {} } };
  const m = { body: MESSAGES[stage], attempts: 1, acked: 0, retried: 0, ack() { this.acked += 1; }, retry() { this.retried += 1; } };
  await worker.queue({ queue: "truedone-dev", messages: [m] }, env);
  t.mock.reset();
  const writes = fake.calls.filter((c) => /\/check-runs(\/\d+)?$/.test(c.url) && c.method !== "GET").map((c) => `${c.method} ${c.url.replace("https://api.github.com", "")}`);
  const reads = fake.calls.filter((c) => c.method === "GET" && /\/check-runs\?/.test(c.url)).map((c) => new URL(c.url).searchParams);
  return { m, lines, writes, reads };
}

for (const stage of ["red-green", "static"]) {
  for (const [who, app] of [["the production App", PROD], ["the development App", DEV]]) {
    test(`the ${stage} stage of ${who} PATCHes its own truedone run, never the other App's listed beside it`, async (t) => {
      const r = await consume(t, stage, app);
      assert.deepEqual([r.m.acked, r.m.retried], [1, 0], `acknowledged, not retried: ${r.lines.join(" | ")}`);
      assert.deepEqual(r.writes, [`PATCH /repos/o/r/check-runs/${runOf(app)}`]);
      assert.ok(r.reads.length > 0, "the stage reads the head's check runs");
      for (const q of r.reads) assert.deepEqual([q.get("check_name"), q.get("app_id")], ["truedone", String(app)]);
    });
  }
  test(`the ${stage} stage of an App with no run on the head creates its own, and updates no other App's`, async (t) => {
    const r = await consume(t, stage, 4242);
    assert.deepEqual([r.m.acked, r.m.retried], [1, 0], `acknowledged, not retried: ${r.lines.join(" | ")}`);
    assert.deepEqual(r.writes, ["POST /repos/o/r/check-runs"]);
  });
}
