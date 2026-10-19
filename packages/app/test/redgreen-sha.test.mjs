// APP-13: a red-green verdict is about one commit. The stage judges a report against the static analysis at the
// report's own commit; it writes the check run at that commit, and the pull request's label only while that commit is
// still the pull request's head. When the pull request has moved on, commits/{report sha}/pulls answers with a newer
// head, and the test file differs at the two commits, so the analysis gives a different verdict at each: one check run
// write at the report's commit, carrying core.judge of the analysis there, and no label. D10: when the analysis at the
// report's commit is tampered, no report overrides it, and the stage writes nothing. When the head has not moved, the
// label is written too, and the analysis's partial flag reaches the check run. GitHub is faked as it answers
// (filename, the shas, 404 for any other ref); the Worker's own default export runs with only fetch, KV and the
// message faked. Refs #100 (the analysis was a Promise), #101 (the check run at the current head).
import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.mjs";
import { analyse, judge, classify } from "../../core/core.mjs";
import { loadPR } from "../../web/lib/github.mjs";
import { fakeGitHub, memoryKV, writeRoutes, checkRuns, labelWrites, pkcs1Pem, storedZip, compareRoute } from "./lib/github.mjs";

const B = "5555555555555555555555555555555555555555"; // the base
const R = "6666666666666666666666666666666666666666"; // the commit the report ran on
const C = "7777777777777777777777777777777777777777"; // the pull request's head now
const STEP = "1111111111111111111111111111111111111111";
// the default branch's head commit, where its workflows are read (APP-29)
const MAIN = "6c2eac62418533b8309d9e933ad9897c055ae053";
const KEPT = "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\ntest('a', () => {\n  assert.equal(f(), 1);\n});\n";
const ADDED_CASE = `${KEPT}test('b', () => {\n  assert.equal(f(), 1);\n});\n`;
const DROPPED = "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\ntest('a', () => {\n  f();\n});\n";
const REPO = { id: 7, name: "r", full_name: "o/r", owner: { login: "o" } };
const PULL = { number: 6, state: "open", title: "t", body: "", user: { login: "someone", type: "User" }, changed_files: 1,
  base: { ref: "main", sha: B, repo: REPO }, head: { ref: "branch", sha: C, repo: REPO } };
// Over the static limit of 20,000 changed lines, so the analysis at R is partial.
const LONG = KEPT + Array.from({ length: 20001 }, (_, i) => `// line ${i}`).join("\n") + "\n";
const REPORT = { schema: "truedone.report/1", head_sha: R, proved_step: STEP,
  tests: [{ name: "a", file: "test/a.test.js", condition: "lines", base: ["fail:assertion"], head: ["pass"] }] };
const PAYLOAD = { action: "completed", repository: { id: 7, name: "r", owner: { login: "o" } }, installation: { id: 3 },
  workflow_run: { id: 77, head_sha: R, head_branch: "branch", conclusion: "success", jobs_url: "https://api.github.com/repos/o/r/actions/runs/77/jobs", head_repository: { full_name: "o/r" } } };

function github(atR, head = C) {
  const zip = storedZip(JSON.stringify(REPORT));
  const pull = { ...PULL, head: { ...PULL.head, sha: head } };
  return fakeGitHub({
    api: {
      "POST /app/installations/3/access_tokens": { token: "tok" },
      [`GET /repos/o/r/commits/${R}/pulls`]: [pull],
      "GET /repos/o/r/pulls/6/files": [{ filename: "test/a.test.js", status: "modified", patch: "@@ -1,5 +1,5 @@" }],
      "GET /repos/o/r/actions/runs/77/jobs": { jobs: [{ id: 1, name: "test" }] },
      "GET /repos/o/r/actions/runs/77/artifacts": { artifacts: [{ name: "truedone-report-test", expired: false, size_in_bytes: zip.length, archive_download_url: "https://api.github.com/artifact/1" }] },
      "GET /artifact/1": () => new Response(zip),
      "GET /repos/o/r": { default_branch: "main" },
      "GET /repos/o/r/git/ref/heads/main": { ref: "refs/heads/main", object: { sha: MAIN, type: "commit" } },
      "GET /repos/o/r/contents/.github/workflows": [{ name: "ci.yml" }],
      ...compareRoute("o", "r", B, C),
      ...writeRoutes("o", "r", 6, C),
      ...compareRoute("o", "r", B, R),
      ...writeRoutes("o", "r", 6, R),
    },
    raw: {
      [`o/r/${B}/test/a.test.js`]: KEPT,
      [`o/r/${R}/test/a.test.js`]: atR,
      ...(head === C ? { [`o/r/${C}/test/a.test.js`]: DROPPED } : {}),
      [`o/r/${MAIN}/.github/workflows/ci.yml`]: `steps:\n  - uses: Truedone/truedone-action@${STEP} # v1\n`,
    },
  });
}

// The static analysis the site's reader gives at one commit of the pull request.
async function analysisAt(fetch, sha) {
  const pr = { ...PULL, head: { ...PULL.head, sha } };
  const { input } = await loadPR({ owner: "o", repo: "r", number: 6 }, { fetch: (u, i) => (String(u).endsWith("/repos/o/r/pulls/6") ? Promise.resolve(Response.json(pr)) : fetch(u, i)), classify });
  return analyse({ ...input, releases: [] });
}

async function deliver(t, fetch) {
  const orig = globalThis.fetch;
  globalThis.fetch = fetch;
  t.after(() => { globalThis.fetch = orig; });
  const m = { body: { event: "workflow_run", delivery: "d-77", payload: PAYLOAD }, acked: 0, retried: 0, ack() { this.acked += 1; }, retry() { this.retried += 1; } };
  await worker.queue({ messages: [m] }, { APP_ID: "12345", PRIVATE_KEY: await pkcs1Pem(), KV: memoryKV(), VERSION: "v" });
  assert.equal(m.acked, 1, `handled, retried ${m.retried}`);
}

const checkWrites = (fetch) => fetch.calls.filter((c) => /\/check-runs(\/\d+)?$/.test(c.url) && ["POST", "PATCH"].includes(c.method));
const title = (v) => `truedone: ${v.verdict.replace(/_/g, " ")}${v.partial ? " (partial)" : ""}`;

test("the pull request moved on: one check run at the report's commit, judged from the analysis there, and no label", async (t) => {
  const atR = await analysisAt(github(ADDED_CASE), R);
  const atC = await analysisAt(github(ADDED_CASE), C);
  assert.notEqual(atR.verdict, atC.verdict, "the two commits analyse differently");
  assert.equal(atC.verdict, "tampered");
  const want = judge(atR, [REPORT]);
  assert.notEqual(want.verdict, "tampered");
  const fetch = github(ADDED_CASE);
  await deliver(t, fetch);
  const checks = checkWrites(fetch);
  assert.equal(checks.length, 1, "one check run write");
  const body = JSON.parse(checks[0].body);
  assert.equal(body.head_sha, R, "at the commit the report ran on");
  assert.equal(body.output.title, title(want));
  assert.equal(labelWrites(fetch, 6).length, 0, "the newer head's label is left to its own run");
});

test("D10: tampered at the report's commit stands; a passing report writes no check run and no label", async (t) => {
  const fetch = github(DROPPED);
  assert.equal((await analysisAt(github(DROPPED), R)).verdict, "tampered");
  await deliver(t, fetch);
  assert.equal(checkWrites(fetch).length, 0);
  assert.equal(labelWrites(fetch, 6).length, 0);
});

test("the head has not moved: the check run and the label, with the analysis's partial flag", async (t) => {
  const atR = await analysisAt(github(LONG, R), R);
  assert.equal(atR.partial, true, "over the line limit");
  const want = judge(atR, [REPORT]);
  assert.equal(want.partial, true);
  const fetch = github(LONG, R);
  await deliver(t, fetch);
  const checks = checkWrites(fetch);
  assert.equal(checks.length, 1, "one check run write");
  assert.equal(JSON.parse(checks[0].body).head_sha, R);
  assert.equal(JSON.parse(checks[0].body).output.title, title(want));
  assert.deepEqual(labelWrites(fetch, 6).map((c) => JSON.parse(c.body).labels), [[want.label]]);
});
