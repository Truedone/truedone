// CORE-12-AC03 (D24): the App's static stage reads a changed file's base content at the pull request's merge base,
// named by one compare call in the base repository, so a test the base branch gained after the pull request branched is
// not called removed; .github/truedone.yml, the repository's setting, is still read at the base branch's tip. The answers
// are sindresorhus/ky#883's, recorded on 2026-10-19 with gh api (fixtures/ky-883: the pull request, its files, the compare
// answer, and test/hooks.ts and test/main.ts at the base branch's tip c2ac4a1 as base-*, the merge base d27ad21 as
// merge-base-* and the head 045fdd7 as head-*). GitHub lists that pull request as test/hooks.ts +33 -0 and test/main.ts
// +52 -0. Read at the tip, nine tests the base branch gained later read as removed and the check run says tampered;
// read at the merge base, no test is removed. The stage runs with core's real analyse, on a GitHub fake that answers 404
// to any route it does not hold.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { makeStatic } from "../src/static.mjs";
import { analyse } from "../../core/core.mjs";
import { fakeGitHub, memoryKV, writeRoutes, delivery, checkRuns, labelWrites, rawCalls, flagsDB, directRun } from "./lib/github.mjs";

const FIX = new URL("./fixtures/ky-883/", import.meta.url);
const read = (name) => fs.readFileSync(new URL(name, FIX), "utf8");
const TIP = "c2ac4a1ac858cd8b423756c6c686b64071e834eb";
const MERGE_BASE = "d27ad21266d162ee218d4ea69dce192b84b6f967";
const HEAD = "045fdd745bf8ce5111fa48309057da5cab2876cc";
const COMPARE = `GET /repos/sindresorhus/ky/compare/${TIP}...${HEAD}`;

// GitHub for ky#883 as recorded, with the routes the stage writes to; over replaces routes
function github(over = {}) {
  const raw = {};
  for (const [prefix, sha] of [["base", TIP], ["merge-base", MERGE_BASE], ["head", HEAD]]) {
    for (const f of ["hooks.ts", "main.ts"]) raw[`sindresorhus/ky/${sha}/test/${f}`] = read(`${prefix}-${f}`);
  }
  return fakeGitHub({
    api: {
      "GET /repos/sindresorhus/ky/pulls/883/files": JSON.parse(read("files.json")),
      [COMPARE]: JSON.parse(read("compare.json")),
      ...writeRoutes("sindresorhus", "ky", 883, HEAD),
      ...over,
    },
    raw,
  });
}

// The stage on the delivery of ky#883, with the real core; what it handed core and what core said
async function stage(t, fetch) {
  const orig = globalThis.fetch;
  globalThis.fetch = fetch;
  t.after(() => { globalThis.fetch = orig; });
  const seen = [];
  const env = { INSTALLATION_TOKEN: "tok", KV: memoryKV(), FLAGS: flagsDB(), core: { analyse: (input) => { const r = analyse(input); seen.push(r); return r; } } };
  await directRun(makeStatic(env), delivery(JSON.parse(read("pull.json"))));
  return seen[0];
}
const posted = (fetch) => checkRuns(fetch).map((c) => JSON.parse(c.body).output);

test("the static stage reads ky#883's base files at the merge base: no test is removed, and the check run is not tampered", async (t) => {
  const fetch = github();
  const result = await stage(t, fetch);
  assert.deepEqual(result.reasons.filter((r) => r.check === "deleted").map((r) => r.message), [], "no test reads as removed");
  assert.notEqual(result.verdict, "tampered");
  assert.equal(result.verdict, "unrun", "added tests with no run: Tests changed: not run");
  assert.deepEqual(posted(fetch).map((o) => o.title), ["truedone: unrun"]);
  assert.deepEqual(labelWrites(fetch, 883).map((c) => JSON.parse(c.body).labels), [["truedone:unrun"]]);
  assert.deepEqual(rawCalls(fetch).filter((u) => u.includes("/test/") && !u.includes(`/${HEAD}/`)).sort(), [`sindresorhus/ky/${MERGE_BASE}/test/hooks.ts`, `sindresorhus/ky/${MERGE_BASE}/test/main.ts`]);
});

test("the check run names the merge base as the base, and the repository's setting is still read at the base branch's tip", async (t) => {
  const fetch = github();
  await stage(t, fetch);
  assert.equal(fetch.calls.filter((c) => c.url.includes("/compare/")).length, 1, "one compare call");
  const [output] = posted(fetch);
  const link = /\[This verdict is wrong\]\((https:\/\/github\.com\/Truedone\/truedone\/issues\/new\?[^)\s]+)\)/.exec(output.summary);
  assert.ok(link, output.summary);
  const q = new URL(link[1]).searchParams;
  assert.equal(q.get("base"), MERGE_BASE);
  assert.equal(q.get("head"), HEAD);
  assert.deepEqual(rawCalls(fetch).filter((u) => u.endsWith("/.github/truedone.yml")), [`sindresorhus/ky/${TIP}/.github/truedone.yml`]);
});

test("a compare call that fails writes no check run and no label, and reads no test file at the base branch tip", async (t) => {
  const fetch = github({ [COMPARE]: () => Response.json({ message: "Server Error" }, { status: 500 }) });
  await assert.rejects(stage(t, fetch));
  assert.deepEqual(checkRuns(fetch), []);
  assert.deepEqual(labelWrites(fetch, 883), []);
  assert.deepEqual(rawCalls(fetch).filter((u) => u.includes(`/${TIP}/test/`)), []);
});
