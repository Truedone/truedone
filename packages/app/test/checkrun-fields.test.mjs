// APP-14-AC01 (#103, #104): every check run the App writes opens the pull request's page on the site as its details,
// https://truedone.pages.dev/<owner>/<repo>/pull/<n>, not the App's homepage, and carries the time of the verdict it
// writes as completed_at, on a new run and on an update of an existing one alike. Live on 2026-10-18 the development
// App's runs linked the site root, and #42's run kept 10:25:31Z after its 11:35 verdict. started_at is when that
// verdict's analysis began, so an updated run shows the seconds its analysis took, not the time since its first write. The Worker's own default
// export runs with only fetch, KV and the message faked, on a GitHub fake that answers as GitHub does.
import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.mjs";
import { fakeGitHub, memoryKV, writeRoutes, delivery, pkcs1Pem, storedZip, flagsDB } from "./lib/github.mjs";

const B = "8888888888888888888888888888888888888888";
const H = "9999999999999999999999999999999999999999";
const STEP = "1111111111111111111111111111111111111111";
// the default branch's head commit, where its workflows are read (APP-29)
const MAIN = "6c2eac62418533b8309d9e933ad9897c055ae053";
const PAGE = "https://truedone.pages.dev/o/r/pull/6";
const KEPT = "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\ntest('a', () => {\n  assert.equal(f(), 1);\n});\n";
const ADDED_CASE = `${KEPT}test('b', () => {\n  assert.equal(f(), 1);\n});\n`;
const REPO = { id: 7, name: "r", full_name: "o/r", owner: { login: "o" } };
const PULL = { number: 6, state: "open", title: "t", body: "", user: { login: "someone", type: "User" }, changed_files: 1,
  base: { ref: "main", sha: B, repo: REPO }, head: { ref: "branch", sha: H, repo: REPO } };
const REPORT = { schema: "truedone.report/1", head_sha: H, proved_step: STEP,
  tests: [{ name: "b", file: "test/a.test.js", condition: "lines", base: ["fail:missing"], head: ["pass"] }] };

// An earlier run on this head, completed at an earlier time, when existing is set.
function github({ existing = false } = {}) {
  const zip = storedZip(JSON.stringify(REPORT));
  return fakeGitHub({
    api: {
      "POST /app/installations/3/access_tokens": { token: "tok" },
      // APP-25: a queued run reads the pull request from GitHub
      "GET /repos/o/r/pulls/6": PULL,
      "GET /repos/o/r/pulls/6/files": [{ filename: "test/a.test.js", status: "modified", patch: "@@ -5,0 +6,3 @@" }],
      [`GET /repos/o/r/commits/${H}/pulls`]: [PULL],
      "GET /repos/o/r/actions/runs/77/jobs": { jobs: [{ id: 1, name: "test" }] },
      "GET /repos/o/r/actions/runs/77/artifacts": { artifacts: [{ name: "truedone-report-test", expired: false, size_in_bytes: zip.length, archive_download_url: "https://api.github.com/artifact/1" }] },
      "GET /artifact/1": () => new Response(zip),
      "GET /repos/o/r": { default_branch: "main" },
      "GET /repos/o/r/git/ref/heads/main": { ref: "refs/heads/main", object: { sha: MAIN, type: "commit" } },
      "GET /repos/o/r/contents/.github/workflows": [{ name: "ci.yml" }],
      ...writeRoutes("o", "r", 6, H),
      ...(existing ? {
        [`GET /repos/o/r/commits/${H}/check-runs`]: { total_count: 1, check_runs: [{ id: 9, completed_at: "2026-10-18T10:25:31Z", details_url: "https://truedone.pages.dev" }] },
        "PATCH /repos/o/r/check-runs/9": { id: 9 },
      } : {}),
    },
    raw: {
      [`o/r/${B}/test/a.test.js`]: KEPT,
      [`o/r/${H}/test/a.test.js`]: ADDED_CASE,
      [`o/r/${MAIN}/.github/workflows/ci.yml`]: `steps:\n  - uses: Truedone/truedone-action@${STEP} # v1\n`,
    },
  });
}

// One delivery through the Worker's queue handler; the window of times its verdict may carry.
async function deliver(t, fetch, body) {
  const orig = globalThis.fetch;
  globalThis.fetch = fetch;
  t.after(() => { globalThis.fetch = orig; });
  const m = { body, acked: 0, retried: 0, ack() { this.acked += 1; }, retry() { this.retried += 1; } };
  const from = Date.now();
  await worker.queue({ messages: [m] }, { APP_ID: "12345", PRIVATE_KEY: await pkcs1Pem(), KV: memoryKV(), FLAGS: flagsDB(), VERSION: "v" });
  const to = Date.now();
  assert.equal(m.acked, 1, `handled, retried ${m.retried}`);
  return { from, to };
}
const writes = (fetch) => fetch.calls.filter((c) => /\/check-runs(\/\d+)?$/.test(c.url) && ["POST", "PATCH"].includes(c.method)).map((c) => ({ method: c.method, url: c.url, body: JSON.parse(c.body) }));
function fields(w, { from, to }) {
  assert.equal(w.body.details_url, PAGE, "the details open the pull request's page");
  for (const k of ["started_at", "completed_at"]) {
    assert.match(String(w.body[k]), /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z$/, `${k} is an ISO time`);
    const at = Date.parse(w.body[k]);
    assert.ok(at >= from && at <= to, `${k} ${w.body[k]} falls within this delivery`);
  }
  assert.ok(Date.parse(w.body.started_at) <= Date.parse(w.body.completed_at), "started_at is not after completed_at");
}
const WORKFLOW_RUN = { event: "workflow_run", delivery: "d-77", payload: { action: "completed", repository: { id: 7, name: "r", owner: { login: "o" } }, installation: { id: 3 },
  workflow_run: { id: 77, head_sha: H, head_branch: "branch", conclusion: "success", jobs_url: "https://api.github.com/repos/o/r/actions/runs/77/jobs", head_repository: { full_name: "o/r" } } } };

test("a new static check run opens the pull request's page and carries its verdict's time", async (t) => {
  const fetch = github();
  const when = await deliver(t, fetch, delivery(PULL));
  const w = writes(fetch);
  assert.deepEqual(w.map((x) => x.method), ["POST"]);
  fields(w[0], when);
});

test("an update of an existing run sets both again, not the first write's time", async (t) => {
  const fetch = github({ existing: true });
  const when = await deliver(t, fetch, delivery(PULL));
  const w = writes(fetch);
  assert.deepEqual(w.map((x) => `${x.method} ${x.url.replace("https://api.github.com", "")}`), ["PATCH /repos/o/r/check-runs/9"]);
  fields(w[0], when);
});

test("the red-green check run carries both too", async (t) => {
  const fetch = github({ existing: true });
  const when = await deliver(t, fetch, WORKFLOW_RUN);
  const w = writes(fetch);
  assert.deepEqual(w.map((x) => x.method), ["PATCH"]);
  fields(w[0], when);
});
