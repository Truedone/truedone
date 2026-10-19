// CORE-14-AC03 (D24): the App's static stage reads the head content of a pull request from a forked repository in the
// base repository, at the head sha, so a head repository that is deleted or private no longer makes every added test
// read as removed. The answers are sindresorhus/ky#871's, recorded on 2026-10-19 with gh api (fixtures/ky-871: the pull
// request, its files, the compare answer, test/hooks.ts at the merge base b101251 in the base repository as base-hooks.ts
// and at the head 1da35ba in the base repository as head-hooks.ts, and the 14-byte 404 that the head repository
// mahirhir/ky, now private, answers for it as fork-head-hooks.404). GitHub lists that pull request as source/core/Ky.ts
// +37 -2 and test/hooks.ts +59 -0. Read in the head repository, the head is missing, every test in test/hooks.ts reads
// as removed and the check run says tampered; read in the base repository, no test is removed. A head file the base
// repository cannot serve throws to the queue path and writes no check run and no label, never a removed test, and the
// line the queue handler logs for it holds no path from the pull request (S8). The stage runs with core's real analyse,
// on a GitHub fake that answers 404 to any route it does not hold.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import worker from "../src/index.mjs";
import { makeStatic } from "../src/static.mjs";
import { analyse } from "../../core/core.mjs";
import { fakeGitHub, memoryKV, writeRoutes, delivery, checkRuns, labelWrites, rawCalls, flagsDB, directRun, pkcs1Pem } from "./lib/github.mjs";

const FIX = new URL("./fixtures/ky-871/", import.meta.url);
const read = (name) => fs.readFileSync(new URL(name, FIX), "utf8");
const MERGE_BASE = "b1012515602768026ae6f27adb76b7bc657764e1";
const HEAD = "1da35ba2a08038025b4245a83d812b368bbcad97";
const COMPARE = `GET /repos/sindresorhus/ky/compare/${MERGE_BASE}...${HEAD}`;
const HEAD_REPO_FILE = `https://raw.githubusercontent.com/mahirhir/ky/${HEAD}/test/hooks.ts`;

// GitHub for ky#871 as recorded, with the routes the stage writes to and any routes in api. served: whether the base
// repository serves the head of test/hooks.ts. The head repository answers its recorded 404.
function github({ served = true, api = {} } = {}) {
  const raw = { [`sindresorhus/ky/${MERGE_BASE}/test/hooks.ts`]: read("base-hooks.ts") };
  if (served) raw[`sindresorhus/ky/${HEAD}/test/hooks.ts`] = read("head-hooks.ts");
  const inner = fakeGitHub({
    api: {
      "GET /repos/sindresorhus/ky/pulls/871/files": JSON.parse(read("files.json")),
      [COMPARE]: JSON.parse(read("compare.json")),
      ...writeRoutes("sindresorhus", "ky", 871, HEAD),
      ...api,
    },
    raw,
  });
  const fetch = async (url, init = {}) => {
    const answer = await inner(url, init);   // the fake records every call
    return String(url) === HEAD_REPO_FILE ? new Response(read("fork-head-hooks.404"), { status: 404 }) : answer;
  };
  fetch.calls = inner.calls;
  return fetch;
}

// The stage on the delivery of ky#871, with the real core; what core said
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

test("the static stage reads ky#871's head in the base repository: no test is removed, and the check run is not tampered", async (t) => {
  const fetch = github();
  const result = await stage(t, fetch);
  assert.deepEqual(result.reasons.filter((r) => r.check === "deleted").map((r) => r.message), [], "no test reads as removed");
  assert.notEqual(result.verdict, "tampered");
  assert.equal(result.verdict, "unrun", "added tests with no run: Tests changed: not run");
  assert.deepEqual(posted(fetch).map((o) => o.title), ["truedone: unrun"]);
  assert.deepEqual(labelWrites(fetch, 871).map((c) => JSON.parse(c.body).labels), [["truedone:unrun"]]);
  assert.deepEqual(rawCalls(fetch).filter((u) => u.endsWith("/test/hooks.ts")).sort(), [`sindresorhus/ky/${HEAD}/test/hooks.ts`, `sindresorhus/ky/${MERGE_BASE}/test/hooks.ts`]);
  assert.deepEqual(rawCalls(fetch).filter((u) => u.startsWith("mahirhir/")), [], "nothing is read in the head repository");
});

test("a head file the base repository cannot serve writes no check run and no label, never a removed test", async (t) => {
  const fetch = github({ served: false });
  const e = await stage(t, fetch).then(() => null, (x) => x);
  assert.ok(e, "the stage throws");
  assert.equal(e.path, "test/hooks.ts");
  assert.deepEqual(checkRuns(fetch), []);
  assert.deepEqual(labelWrites(fetch, 871), []);
});

test("the queue handler's line for a head file the base repository cannot serve holds no path from the pull request", async (t) => {
  const pull = JSON.parse(read("pull.json"));
  const paths = JSON.parse(read("files.json")).flatMap((f) => [f.filename, f.filename.split("/").pop()]);
  // a queued run reads the pull request from GitHub and mints its token (APP-25)
  const fetch = github({ served: false, api: { "GET /repos/sindresorhus/ky/pulls/871": pull, "POST /app/installations/3/access_tokens": { token: "tok-871" } } });
  const orig = globalThis.fetch;
  globalThis.fetch = fetch;
  t.after(() => { globalThis.fetch = orig; });
  const logged = t.mock.method(console, "error", () => {});
  const m = { body: delivery(pull), acked: 0, retried: 0, ack() { this.acked += 1; }, retry() { this.retried += 1; } };
  await worker.queue({ messages: [m] }, { APP_ID: "12345", PRIVATE_KEY: await pkcs1Pem(), KV: memoryKV(), FLAGS: flagsDB(), VERSION: "v" });
  assert.equal(m.retried, 1, "left to the queue's retry");
  assert.equal(m.acked, 0);
  const lines = logged.mock.calls.map((c) => c.arguments.map(String).join(" "));
  assert.ok(lines.length > 0, "the failure is logged");
  for (const line of lines) for (const p of paths) assert.ok(!line.includes(p), `no path from the pull request in ${line}`);
  const failed = lines.map((l) => JSON.parse(l)).filter((l) => l.stage === "static");
  assert.equal(failed.length, 1, "one line for the failed delivery");
  assert.equal(failed[0].delivery, "d-871");
  assert.match(failed[0].error, /404 for a file at the head commit/);
  assert.deepEqual(checkRuns(fetch), []);
});
