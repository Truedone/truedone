// APP-27 (Truedone/truedone#164): the red-green stage believes a report only when its proved_step is the truedone step the
// default branch pins or a published release (PV-A06). Measured on 2026-10-19: publishedShas read the tags of
// truedone/action, which answers 404, so no release was ever known (the release repository is Truedone/truedone-action,
// whose tags answered 200 with []), and defaultStepSha matched only `...truedone-action...@<40 hex>`, so the sandbox's
// interim step Truedone/truedone/packages/action@<sha> gave null. Everything goes through the Worker's queue consumer, with
// GitHub answering in its own shapes (the tag entry as GitHub answered for actions/checkout that day):
// - a step pinned in either form, by a full 40-hex SHA, is the default branch's step, and the report is believed;
// - an unpinned step (a branch, a tag, a short SHA) and a step of another repository match nothing: each report names the
//   unpinned ref itself as its proved_step, so a looser match would believe it;
// - the release SHAs come from the tags of Truedone/truedone-action, and truedone/action is never read;
// - every refused report logs one line of identifiers and the reason, and writes nothing.
import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.mjs";
import { LABELS } from "../src/labels.mjs";
import { fakeGitHub, writeRoutes, pkcs1Pem, flagsDB, memoryKV, checkRuns, labelWrites, storedZip } from "./lib/github.mjs";

const KEY = await pkcs1Pem();
const B = "cccccccccccccccccccccccccccccccccccccccc";
const H = "dddddddddddddddddddddddddddddddddddddddd";
const STEP = "a1b2c3d4e5a1b2c3d4e5a1b2c3d4e5a1b2c3d4e5";
const RELEASE = "0f9e8d7c6b0f9e8d7c6b0f9e8d7c6b0f9e8d7c6b";
const OLDER = "5a4b3c2d1e5a4b3c2d1e5a4b3c2d1e5a4b3c2d1e";
const REPO = { id: 7, name: "r", full_name: "o/r", owner: { login: "o" } };
const TAGS = "https://api.github.com/repos/Truedone/truedone-action/tags?per_page=100";

// GitHub's answer to GET /repos/{owner}/{repo}/tags, one entry per tag
const tag = (name, sha) => ({
  name,
  zipball_url: `https://api.github.com/repos/Truedone/truedone-action/zipball/refs/tags/${name}`,
  tarball_url: `https://api.github.com/repos/Truedone/truedone-action/tarball/refs/tags/${name}`,
  commit: { sha, url: `https://api.github.com/repos/Truedone/truedone-action/commits/${sha}` },
  node_id: `REF_${name}`,
});

const TEST_BEFORE = `import { test } from 'node:test';\nimport assert from 'node:assert/strict';\ntest('a', () => {\n  assert.equal(f(), 1);\n});\n`;
const TEST_AFTER = `${TEST_BEFORE}test('a again', () => {\n  assert.equal(f(), 1);\n});\n`;
const report = (provedStep) => JSON.stringify({
  schema: "truedone.report/1", head_sha: H, proved_step: provedStep,
  tests: [{ name: "a again", file: "test/a.test.js", condition: "lines", base: ["fail:assertion"], head: ["pass", "pass", "pass"] }],
});
const workflow = (uses) => `name: ci\non: [pull_request]\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n${uses}\n`;
const listing = (name) => ({
  name, path: `.github/workflows/${name}`, sha: "f".repeat(40), size: 200, type: "file",
  url: `https://api.github.com/repos/o/r/contents/.github/workflows/${name}?ref=main`,
  download_url: `https://raw.githubusercontent.com/o/r/main/.github/workflows/${name}`,
});

// GitHub for o/r's workflow run 77 on H, pull request 41: the default branch's ci.yml holds uses, the run's artifact
// holds a report naming provedStep (or the text given), and Truedone/truedone-action has the tags given
function github({ uses, provedStep, tags = [], text = report(provedStep) }) {
  const pr41 = { number: 41, state: "open", title: "t", body: "", user: { login: "someone", type: "User" }, changed_files: 1,
    head: { sha: H, ref: "branch", repo: REPO }, base: { sha: B, ref: "main", repo: REPO } };
  return fakeGitHub({
    api: {
      "POST /app/installations/3/access_tokens": { token: "tok" },
      [`GET /repos/o/r/commits/${H}/pulls`]: [pr41],
      "GET /repos/o/r/pulls/41/files": [{ filename: "test/a.test.js", status: "modified", patch: "@@ -1,1 +1,1 @@" }],
      "GET /repos/o/r/actions/runs/77/jobs": { total_count: 1, jobs: [{ id: 1, name: "test", status: "completed", conclusion: "success" }] },
      "GET /repos/o/r/actions/runs/77/artifacts": { total_count: 1, artifacts: [{ id: 9, name: "truedone-report-test", expired: false, size_in_bytes: 400, archive_download_url: "https://api.github.com/repos/o/r/actions/artifacts/9/zip" }] },
      "GET /repos/o/r/actions/artifacts/9/zip": () => new Response(storedZip(text)),
      "GET /repos/o/r": { ...REPO, private: false, default_branch: "main" },
      "GET /repos/o/r/contents/.github/workflows": [listing("ci.yml")],
      "GET /repos/Truedone/truedone-action/tags": tags,
      ...writeRoutes("o", "r", 41, H),
      "GET /repos/o/r/labels": LABELS.map((l) => ({ name: l.name })),
    },
    raw: {
      [`o/r/${B}/test/a.test.js`]: TEST_BEFORE,
      [`o/r/${H}/test/a.test.js`]: TEST_AFTER,
      "o/r/main/.github/workflows/ci.yml": workflow(uses),
    },
  });
}

const ORIGINAL_FETCH = globalThis.fetch;
// one fresh Worker env per run: the stage keeps the release SHAs on it
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
      workflow_run: { id: 77, head_sha: H, head_repository: { full_name: "o/r" }, conclusion: "success", jobs_url: "https://api.github.com/repos/o/r/actions/runs/77/jobs" } },
  }, attempts: 1, acked: 0, retried: 0, ack() { this.acked += 1; }, retry() { this.retried += 1; } };
  await worker.queue({ queue: "truedone-dev", messages: [m] }, env);
  t.mock.reset();
  assert.deepEqual([m.acked, m.retried], [1, 0], `acknowledged once: ${lines.join(" | ")}`);
  return { lines: lines.map((l) => JSON.parse(l)), checks: checkRuns(fake).length, labels: labelWrites(fake, 41).length, urls: fake.calls.map((c) => c.url) };
}
const believed = (r) => {
  assert.deepEqual(r.lines, [], "no line logged");
  assert.deepEqual([r.checks, r.labels], [1, 1], `the check run and the label are written: ${r.urls.join(" | ")}`);
};
const refused = (r) => {
  assert.deepEqual(r.lines, [{ stage: "red-green", delivery: "d-run", repository: 7, pr: 41, refused: "proved_step" }]);
  assert.deepEqual([r.checks, r.labels], [0, 0], "nothing is written");
};

for (const uses of [
  `      - uses: Truedone/truedone/packages/action@${STEP}`,
  `      - uses: Truedone/truedone-action@${STEP} # v1`,
  `      - uses: "Truedone/truedone-action@${STEP}"`,
  `      - name: truedone\n        uses: truedone/truedone/packages/action@${STEP}`,
]) {
  test(`the default branch's step ${JSON.stringify(uses.trim())} is found, and a report proving it is believed`, async (t) => {
    believed(await run(t, github({ uses, provedStep: STEP })));
  });
}

for (const action of ["Truedone/truedone-action", "Truedone/truedone/packages/action"]) {
  // a 41-character ref is no SHA either, and its first 40 characters are no step
  for (const [ref, provedStep] of [["main", "main"], ["v1", "v1"], ["v1.2.0", "v1.2.0"], ["a1b2c3d", "a1b2c3d"], [`${STEP}0`, STEP]]) {
    test(`an unpinned step ${action}@${ref} matches nothing, so a report proving ${provedStep} is refused and logged`, async (t) => {
      refused(await run(t, github({ uses: `      - uses: ${action}@${ref}`, provedStep })));
    });
  }
}

for (const uses of [
  `      - uses: someone/truedone-action@${STEP}`,
  `      - uses: Truedone/truedone-action-fork@${STEP}`,
  `      # - uses: Truedone/truedone-action@${STEP}`,
  `      - run: echo "uses: Truedone/truedone-action@${STEP}"`,
]) {
  test(`${JSON.stringify(uses.trim())} is not a truedone step, so a report proving its SHA is refused and logged`, async (t) => {
    refused(await run(t, github({ uses, provedStep: STEP })));
  });
}

test("a report proving a release tagged on Truedone/truedone-action is believed, and truedone/action is never read", async (t) => {
  const r = await run(t, github({ uses: "      - uses: Truedone/truedone-action@main", provedStep: RELEASE, tags: [tag("v0.2.0", RELEASE), tag("v0.1.0", OLDER)] }));
  believed(r);
  assert.deepEqual(r.urls.filter((u) => u.includes("/tags")), [TAGS]);
  assert.deepEqual(r.urls.filter((u) => /\/repos\/truedone\/action\b/i.test(u)), []);
});

test("a report proving a SHA no tag names is refused and logged, with the tags read", async (t) => {
  const r = await run(t, github({ uses: "      - uses: Truedone/truedone-action@main", provedStep: STEP, tags: [tag("v0.2.0", RELEASE), tag("v0.1.0", OLDER)] }));
  refused(r);
  assert.deepEqual(r.urls.filter((u) => u.includes("/tags")), [TAGS]);
});

for (const [why, text] of [
  ["not json", "{"],
  ["schema", JSON.stringify({ schema: "truedone.report/0", head_sha: H, proved_step: STEP, tests: [] })],
  ["head_sha", JSON.stringify({ schema: "truedone.report/1", head_sha: B, proved_step: STEP, tests: [] })],
  ["tests", JSON.stringify({ schema: "truedone.report/1", head_sha: H, proved_step: STEP, tests: {} })],
]) {
  test(`a report refused for ${why} logs that reason in the same one line`, async (t) => {
    const r = await run(t, github({ uses: `      - uses: Truedone/truedone-action@${STEP}`, text }));
    assert.deepEqual(r.lines, [{ stage: "red-green", delivery: "d-run", repository: 7, pr: 41, refused: why }]);
    assert.deepEqual([r.checks, r.labels], [0, 0], "nothing is written");
  });
}
