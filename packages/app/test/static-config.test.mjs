// APP-13-AC02: .github/truedone.yml is the repository's setting, read at pull_request.base.sha. A pull request that adds
// "enabled: false" on its own branch is still checked; "enabled: false" at the base still stops the stage before it
// reads any file. Before APP-13 the stage read the file at the pull request's head ref, so any pull request could
// switch truedone off for itself.
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeStatic } from "../src/static.mjs";
import { analyse } from "../../core/core.mjs";
import { fakeGitHub, memoryKV, writeRoutes, delivery, checkRuns, labelWrites, rawCalls, flagsDB, directRun, compareRoute } from "./lib/github.mjs";

const BASE_SHA = "3333333333333333333333333333333333333333";
const HEAD_SHA = "4444444444444444444444444444444444444444";
const OFF = "enabled: false\n";
const KEPT = "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\ntest('a', () => {\n  assert.equal(f(), 1);\n});\n";
const DROPPED = "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\ntest('a', () => {\n  f();\n});\n";
const PULL = {
  number: 5, state: "open", title: "t", body: "", user: { login: "someone", type: "User" }, changed_files: 2,
  base: { ref: "main", sha: BASE_SHA, repo: { id: 7, name: "r", full_name: "o/r", owner: { login: "o" } } },
  head: { ref: "branch", sha: HEAD_SHA, repo: { id: 7, name: "r", full_name: "o/r", owner: { login: "o" } } },
};
const FILES = [
  { filename: "test/a.test.js", status: "modified", patch: "@@ -3,3 +3,3 @@\n test('a', () => {\n-  assert.equal(f(), 1);\n+  f();\n });" },
  { filename: ".github/truedone.yml", status: "added", patch: "@@ -0,0 +1 @@\n+enabled: false" },
];

async function run(t, raw) {
  const fetch = fakeGitHub({ api: { "GET /repos/o/r/pulls/5/files": FILES, ...compareRoute("o", "r", BASE_SHA, HEAD_SHA), ...writeRoutes("o", "r", 5, HEAD_SHA) }, raw });
  const orig = globalThis.fetch;
  globalThis.fetch = fetch;
  t.after(() => { globalThis.fetch = orig; });
  const out = await directRun(makeStatic({ INSTALLATION_TOKEN: "tok", KV: memoryKV(), FLAGS: flagsDB(), core: { analyse } }), delivery(PULL));
  return { fetch, out };
}
const contents = { [`o/r/${BASE_SHA}/test/a.test.js`]: KEPT, [`o/r/${HEAD_SHA}/test/a.test.js`]: DROPPED };

test("a pull request that adds enabled: false on its own branch is still checked", async (t) => {
  const { fetch, out } = await run(t, { ...contents, [`o/r/${HEAD_SHA}/.github/truedone.yml`]: OFF, "o/r/branch/.github/truedone.yml": OFF });
  assert.equal(checkRuns(fetch).length, 1, "one check run");
  assert.equal(labelWrites(fetch, 5).length, 1, "one label");
  assert.equal(out.verdict, "tampered");
  assert.ok(rawCalls(fetch).includes(`o/r/${BASE_SHA}/.github/truedone.yml`), "the setting is read at the base sha");
  assert.ok(!rawCalls(fetch).includes("o/r/branch/.github/truedone.yml"), "never at the pull request's own branch");
});

test("enabled: false at the base sha stops the stage before it reads any file", async (t) => {
  const { fetch, out } = await run(t, { ...contents, [`o/r/${BASE_SHA}/.github/truedone.yml`]: OFF });
  assert.deepEqual(out, { skipped: "repo_disabled" });
  assert.equal(checkRuns(fetch).length, 0);
  assert.equal(labelWrites(fetch, 5).length, 0);
  assert.deepEqual(rawCalls(fetch), [`o/r/${BASE_SHA}/.github/truedone.yml`]);
  assert.equal(fetch.calls.filter((c) => c.url.includes("/files")).length, 0);
});
