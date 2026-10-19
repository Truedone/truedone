// APP-13-AC01: the static stage compares a modified test file with its content at pull_request.base.sha, so a deleted
// assertion reads tampered; an added file has no base, and a renamed file's base is read at its previous path. The
// input is the site's own (loadPR, packages/web/lib/github.mjs): on the recorded mgillr/truedone-sandbox#42 answers the
// App hands core exactly what truedone.pages.dev builds, and core says unrun, where the development App posted "not
// applicable" live on 2026-10-18 10:25Z (it read f.path, and GitHub sends filename). GitHub is faked as it answers:
// filename, the base sha, and 404 for any other ref.
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeStatic } from "../src/static.mjs";
import { analyse, classify } from "../../core/core.mjs";
import { loadPR } from "../../web/lib/github.mjs";
import fs from "node:fs";
import { fakeGitHub, memoryKV, writeRoutes, delivery, checkRuns, labelWrites, rawCalls, sandbox42, flagsDB, directRun, compareRoute } from "./lib/github.mjs";

const BASE_SHA = "1111111111111111111111111111111111111111";
const HEAD_SHA = "2222222222222222222222222222222222222222";
const KEPT = "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\ntest('a', () => {\n  assert.equal(f(), 1);\n});\n";
const DROPPED = "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\ntest('a', () => {\n  f();\n});\n";
const DROP_PATCH = "@@ -1,5 +1,5 @@\n import { test } from 'node:test';\n import assert from 'node:assert/strict';\n test('a', () => {\n-  assert.equal(f(), 1);\n+  f();\n });";
// The added file a pull request brings, focus marker and all. It lives under fixtures/, which the contract's forbidden
// scan ignores, and the patch GitHub would send for it is built from its lines.
const ADDED = fs.readFileSync(new URL("./fixtures/added-test-only.txt", import.meta.url), "utf8");
const addedPatch = (text) => { const lines = text.trimEnd().split("\n"); return `@@ -0,0 +1,${lines.length} @@\n${lines.map((l) => `+${l}`).join("\n")}`; };
const pull = (n) => ({
  number: n, state: "open", title: "t", body: "", user: { login: "someone", type: "User" }, changed_files: 1,
  base: { ref: "main", sha: BASE_SHA, repo: { id: 7, name: "r", full_name: "o/r", owner: { login: "o" } } },
  head: { ref: "branch", sha: HEAD_SHA, repo: { id: 7, name: "r", full_name: "o/r", owner: { login: "o" } } },
});

// The stage run against the fake with the real core, recording the input it hands core.
async function stage(t, pr, files, raw) {
  const [o, r] = pr.base.repo.full_name.split("/");
  const fetch = fakeGitHub({ api: { [`GET /repos/${o}/${r}/pulls/${pr.number}/files`]: files, ...compareRoute(o, r, pr.base.sha, pr.head.sha), ...writeRoutes(o, r, pr.number, pr.head.sha) }, raw });
  const orig = globalThis.fetch;
  globalThis.fetch = fetch;
  t.after(() => { globalThis.fetch = orig; });
  const inputs = [];
  const env = { INSTALLATION_TOKEN: "tok", KV: memoryKV(), FLAGS: flagsDB(), core: { analyse: (input) => { inputs.push(input); return analyse(input); } } };
  await directRun(makeStatic(env), delivery(pr));
  return { fetch, input: inputs[0] };
}
const title = (fetch) => checkRuns(fetch).map((c) => JSON.parse(c.body).output.title);
const labels = (fetch, n) => labelWrites(fetch, n).map((c) => JSON.parse(c.body).labels);

test("a modified test that loses its assertion is compared with the base sha and reads tampered", async (t) => {
  const { fetch } = await stage(t, pull(7), [{ filename: "test/a.test.js", status: "modified", patch: DROP_PATCH }],
    { [`o/r/${BASE_SHA}/test/a.test.js`]: KEPT, [`o/r/${HEAD_SHA}/test/a.test.js`]: DROPPED });
  assert.deepEqual(rawCalls(fetch).filter((u) => u.endsWith("test/a.test.js")), [`o/r/${BASE_SHA}/test/a.test.js`, `o/r/${HEAD_SHA}/test/a.test.js`]);
  assert.deepEqual(title(fetch), ["truedone: tampered"]);
  assert.deepEqual(labels(fetch, 7), [["truedone:tampered"]]);
});

test("an added test file has no base: nothing is fetched at the base sha for it", async (t) => {
  const { fetch, input } = await stage(t, pull(8), [{ filename: "test/b.test.js", status: "added", patch: addedPatch(ADDED) }],
    { [`o/r/${HEAD_SHA}/test/b.test.js`]: ADDED, [`o/r/${BASE_SHA}/test/b.test.js`]: ADDED });
  assert.deepEqual(rawCalls(fetch).filter((u) => u.endsWith("test/b.test.js")), [`o/r/${HEAD_SHA}/test/b.test.js`]);
  assert.equal(input.files[0].base, undefined);
  assert.equal(input.files[0].head, ADDED);
  assert.deepEqual(title(fetch), [`truedone: ${analyse(input).verdict.replace(/_/g, " ")}`]);
});

test("a renamed test file's base is read at its previous path", async (t) => {
  const { fetch, input } = await stage(t, pull(9), [{ filename: "test/new.test.js", previous_filename: "test/old.test.js", status: "renamed", patch: DROP_PATCH }],
    { [`o/r/${BASE_SHA}/test/old.test.js`]: KEPT, [`o/r/${HEAD_SHA}/test/new.test.js`]: DROPPED });
  assert.deepEqual(rawCalls(fetch).filter((u) => u.includes(".test.js")), [`o/r/${BASE_SHA}/test/old.test.js`, `o/r/${HEAD_SHA}/test/new.test.js`]);
  assert.equal(input.files[0].previous_path, "test/old.test.js");
  assert.equal(input.files[0].base, KEPT);
});

// The deepEqual is a consistency check: the site's input comes through the same loadPR, so it proves the delivery's
// pull request stands in for GitHub's answer, not that the reader is right. The path and the unrun verdict are the
// independent pins (the reader's own mistakes are caught by the cases above).
test("on the recorded sandbox#42 answers the App hands core what the site builds, and core says unrun", async (t) => {
  const s = sandbox42();
  const { fetch, input } = await stage(t, s.pull, s.files, s.raw);
  const site = await loadPR({ owner: s.owner, repo: s.repo, number: 42 }, {
    fetch: fakeGitHub({ api: { ...s.api, [`GET /repos/${s.owner}/${s.repo}/pulls/42`]: s.pull }, raw: s.raw }),
    classify,
  });
  assert.deepEqual(input, { ...site.input, releases: [] });
  assert.equal(input.files[0].path, "python/tests/test_calc.py");
  assert.equal(analyse(input).verdict, "unrun");
  assert.deepEqual(title(fetch), ["truedone: unrun"]);
  assert.deepEqual(labels(fetch, 42), [["truedone:unrun"]]);
});

test("every call carries the App's user-agent, and the token goes to api.github.com only", async (t) => {
  const s = sandbox42();
  const { fetch } = await stage(t, s.pull, s.files, s.raw);
  assert.ok(fetch.calls.length > 5);
  for (const c of fetch.calls) {
    assert.equal(c.headers["user-agent"], "truedone-app", c.url);
    if (!c.url.startsWith("https://api.github.com/")) assert.equal(c.headers.authorization, undefined, c.url);
  }
});
