// APP-25 (Truedone/truedone#125): the intake queued the whole GitHub payload, with the pull request's title, body and
// author login, and after max_retries = 3 a message went to a dead-letter queue with no consumer, where Cloudflare keeps
// it for four days (truedone-dev-dlq held 386 messages, 6,633,339 bytes, on 2026-10-18 at 20:58Z). The analysis does
// read that text: static.mjs's shim answered the pull request from the payload, and core.analyse reads the author (the
// bot verdict) and the title and body (the claim finding). Now a queued delivery carries only the fields its stage
// reads, a queued run reads the pull request from GitHub, and each dead-letter queue has a consumer that logs one line
// of identifiers and acknowledges. Everything goes through the Worker's own default export:
// - every queue send (a pull_request with no ctx, a failed direct run, a late direct run, a workflow_run) carries only
//   the slim fields, and none of the planted text;
// - a queued pull_request fetches the pull request from GitHub and is analysed at the queued shas, where its check and
//   label are written; the direct run makes no such call;
// - the bot verdict and the claim finding come from GitHub's text on a queued run, as from the payload's on a direct one;
// - a message in the old full shape makes the same GitHub calls and writes as its slim form, for both stages;
// - a batch from either dead-letter queue is logged as one line of identifiers per message and acknowledged; a batch
//   from either main queue still goes to the stages;
// - wrangler.toml gives each environment's dead-letter queue that consumer.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import worker from "../src/index.mjs";
import { LABELS } from "../src/labels.mjs";
import { fakeGitHub, writeRoutes, pkcs1Pem, flagsDB, memoryKV, checkRuns, labelWrites, rawCalls, storedZip, compareRoute } from "./lib/github.mjs";

const SECRET = "slim-secret";
const KEY = await pkcs1Pem();
const B = "cccccccccccccccccccccccccccccccccccccccc";
const H = "dddddddddddddddddddddddddddddddddddddddd";
const H2 = "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
// the default branch's head commit, where its workflows are read (APP-29)
const MAIN = "6c2eac62418533b8309d9e933ad9897c055ae053";
const REPO = { id: 7, name: "r", full_name: "o/r", owner: { login: "o" } };
const PLANTED = ["PLANTED-TITLE", "PLANTED-BODY", "planted-author", "PLANTED-COMMIT", "planted@example.com", "PLANTED-DISPLAY", "planted-actor", "PLANTED-DESCRIPTION"];

// the pull request as GitHub answers it; head is where the branch now points
const pull = ({ title = "PLANTED-TITLE", body = "PLANTED-BODY", login = "planted-author", head = H } = {}) => ({
  number: 6, state: "open", title, body, user: { login, type: "User" }, changed_files: 1,
  base: { ref: "main", sha: B, repo: REPO }, head: { ref: "branch", sha: head, repo: REPO },
});
const prPayload = (pr, action = "synchronize") => ({
  action, number: 6, pull_request: pr,
  repository: { ...REPO, description: "PLANTED-DESCRIPTION" }, installation: { id: 3 }, sender: { login: "planted-author" },
});
// what the stage reads of that payload, written out here rather than taken from the code
const SLIM_PR = { action: "synchronize", installation: { id: 3 }, repository: { id: 7, name: "r", owner: { login: "o" } }, pull_request: { number: 6, base: { sha: B }, head: { sha: H } } };

const TEST_BEFORE = `import { test } from 'node:test';\nimport assert from 'node:assert/strict';\ntest('a', () => {\n  assert.equal(f(), 1);\n});\n`;
const TEST_AFTER = `${TEST_BEFORE}test('a again', () => {\n  assert.equal(f(), 1);\n});\n`;
// GitHub for o/r#6: the pull request (answer), its one changed file at the base and the queued head, and the writes
function github(answer, { file = "test/a.test.js", tokens = { token: "tok" } } = {}) {
  const source = file.startsWith("src/");
  return fakeGitHub({
    api: {
      "POST /app/installations/3/access_tokens": tokens,
      "GET /repos/o/r/pulls/6": answer,
      "GET /repos/o/r/pulls/6/files": [{ filename: file, status: "modified", patch: "@@ -1,1 +1,1 @@" }],
      ...compareRoute("o", "r", B, H),
      ...writeRoutes("o", "r", 6, H),
      "GET /repos/o/r/labels": LABELS.map((l) => ({ name: l.name })),
    },
    raw: {
      [`o/r/${B}/${file}`]: source ? "export const a = 1;\n" : TEST_BEFORE,
      [`o/r/${H}/${file}`]: source ? "export const a = 2;\n" : TEST_AFTER,
      [`o/r/${H2}/${file}`]: "a later commit\n",
    },
  });
}
const ORIGINAL_FETCH = globalThis.fetch;
function useFetch(t, fake) {
  globalThis.fetch = fake;
  t.after(() => { globalThis.fetch = ORIGINAL_FETCH; });
  return fake;
}
function environment() {
  const sent = [];
  const env = {
    WEBHOOK_SECRET: SECRET, APP_ID: "12345", PRIVATE_KEY: KEY, KV: memoryKV(), FLAGS: flagsDB({ posting_enabled: "on" }), VERSION: "v",
    QUEUE: { async send(body, opts) { sent.push([structuredClone(body), opts]); } },
  };
  return { env, sent };
}
async function signed(payload, event, delivery) {
  const body = new TextEncoder().encode(JSON.stringify(payload));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = [...new Uint8Array(await crypto.subtle.sign("HMAC", key, body))].map((b) => b.toString(16).padStart(2, "0")).join("");
  return new Request("https://truedone.dev/api/github/webhook", {
    method: "POST",
    headers: { "content-type": "application/json", "x-github-delivery": delivery, "x-github-event": event, "x-hub-signature-256": `sha256=${mac}` },
    body,
  });
}
const waitingCtx = () => { const waited = []; return { waited, waitUntil(p) { waited.push(p); } }; };
const message = (body) => ({ body, attempts: 1, acked: 0, retried: 0, ack() { this.acked += 1; }, retry() { this.retried += 1; } });
async function consume(env, body, queue = "truedone-dev") {
  const m = message(body);
  await worker.queue({ queue, messages: [m] }, env);
  return m;
}
const planted = (x) => PLANTED.filter((s) => JSON.stringify(x).includes(s));
const prFetches = (fake) => fake.calls.filter((c) => c.method === "GET" && c.url === "https://api.github.com/repos/o/r/pulls/6").length;
const verdictOf = (fake) => { const c = checkRuns(fake); assert.equal(c.length, 1, "one check run"); return JSON.parse(c[0].body).output; };
// every call, and each write's body without its times, in a fixed order (the mint's signing runs beside the config
// read, so the order of those two calls can vary)
const trace = (fake) => fake.calls.map((c) => {
  const body = c.body && JSON.parse(c.body);
  if (body) { delete body.started_at; delete body.completed_at; }
  return JSON.stringify([c.method, c.url, body ?? null]);
}).sort();

test("every queue send carries only the fields its stage reads, and none of the pull request's text", async (t) => {
  // a pull_request with no ctx is queued
  useFetch(t, github(pull()));
  const a = environment();
  const r = await worker.fetch(await signed(prPayload(pull()), "pull_request", "d-queued"), a.env);
  assert.deepEqual(JSON.parse(await r.text()), { queued: "pull_request" });
  assert.deepEqual(a.sent, [[{ event: "pull_request", delivery: "d-queued", payload: SLIM_PR }, undefined]]);
  // a direct run that fails (the token is refused with a 500) is handed to the queue
  useFetch(t, github(pull(), { tokens: () => new Response("no", { status: 500 }) }));
  const b = environment();
  const ctx = waitingCtx();
  t.mock.method(console, "error", () => {});
  await worker.fetch(await signed(prPayload(pull()), "pull_request", "d-failed"), b.env, ctx);
  await Promise.all(ctx.waited);
  assert.deepEqual(b.sent, [[{ event: "pull_request", delivery: "d-failed", payload: SLIM_PR }, undefined]]);
  assert.deepEqual(planted([a.sent, b.sent]), []);
});

test("a late direct run is handed to the queue in the slim shape", async (t) => {
  // the token never comes, so the run outlasts the 20 s budget, which the mocked clock passes at once. The clock moves
  // only once the token call has been made: the mint signs with real crypto first, and a call made after this test
  // ended would reach the next test's fake.
  let asked = false;
  useFetch(t, github(pull(), { tokens: () => { asked = true; return new Promise(() => {}); } }));
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { env, sent } = environment();
  const ctx = waitingCtx();
  const r = await worker.fetch(await signed(prPayload(pull()), "pull_request", "d-late"), env, ctx);
  assert.deepEqual(JSON.parse(await r.text()), { analysing: "pull_request" });
  while (!asked) await new Promise((resolve) => setImmediate(resolve));
  t.mock.timers.tick(20_000);
  await Promise.all(ctx.waited);
  assert.deepEqual(sent, [[{ event: "pull_request", delivery: "d-late", payload: SLIM_PR }, { delaySeconds: 15 }]]);
  assert.deepEqual(planted(sent), []);
});

test("a queued pull_request fetches the pull request and is analysed at the queued shas; the direct run does not fetch it", async (t) => {
  // GitHub's branch has moved on to H2 since the delivery
  const gh = useFetch(t, github(pull({ head: H2 })));
  const { env, sent } = environment();
  await worker.fetch(await signed(prPayload(pull()), "pull_request", "d-1"), env);
  const m = await consume(env, sent[0][0]);
  assert.deepEqual([m.acked, m.retried], [1, 0]);
  assert.equal(prFetches(gh), 1, "the pull request is read from GitHub once");
  assert.ok(rawCalls(gh).includes(`o/r/${H}/test/a.test.js`), `read at the queued head: ${rawCalls(gh)}`);
  assert.deepEqual(rawCalls(gh).filter((u) => u.includes(H2)), [], "nothing read at GitHub's newer head");
  assert.equal(JSON.parse(checkRuns(gh)[0].body).head_sha, H, "the check is written at the queued head");
  assert.equal(labelWrites(gh, 6).length, 1, `the label is written once: ${labelWrites(gh, 6).map((c) => `${c.method} ${c.url} ${c.body}`).join(" | ")}`);
  // the direct run analyses the delivery's pull request from memory
  const direct = useFetch(t, github(pull()));
  const d = environment();
  const ctx = waitingCtx();
  await worker.fetch(await signed(prPayload(pull()), "pull_request", "d-2"), d.env, ctx);
  await Promise.all(ctx.waited);
  assert.equal(checkRuns(direct).length, 1, "the direct run wrote its check");
  assert.equal(prFetches(direct), 0, "the direct run makes no extra call");
});

for (const [name, text, neutral, file] of [
  ["the bot verdict", { login: "renovate[bot]", title: "t", body: "" }, { login: "someone", title: "t", body: "" }, "test/a.test.js"],
  ["the claim finding", { login: "someone", title: "t", body: "This adds tests" }, { login: "someone", title: "t", body: "" }, "src/a.js"],
]) {
  test(`${name} comes from GitHub's text on a queued run, as from the payload's on a direct one`, async (t) => {
    // the direct run: the text in the delivery
    const direct = useFetch(t, github(pull(text), { file }));
    const d = environment();
    const ctx = waitingCtx();
    await worker.fetch(await signed(prPayload(pull(text)), "pull_request", "d-direct"), d.env, ctx);
    await Promise.all(ctx.waited);
    const fromPayload = verdictOf(direct);
    // the queued run: the same text, read from GitHub
    const q = environment();
    useFetch(t, github(pull(text), { file }));
    await worker.fetch(await signed(prPayload(pull(text)), "pull_request", "d-queued"), q.env);
    const queuedBody = q.sent[0][0];
    const same = useFetch(t, github(pull(text), { file }));
    await consume(q.env, queuedBody);
    assert.deepEqual(verdictOf(same), fromPayload, "the queued run reads the same verdict from GitHub");
    // GitHub's text now differs from the delivery's: the queued run follows GitHub
    const other = useFetch(t, github(pull(neutral), { file }));
    await consume(q.env, queuedBody);
    assert.notDeepEqual(verdictOf(other), fromPayload, `the verdict follows GitHub's text: ${JSON.stringify(fromPayload.title)}`);
  });
}

test("a pull_request message in the old full shape makes the same GitHub calls and writes as its slim form", async (t) => {
  const { env } = environment();
  const full = useFetch(t, github(pull()));
  const a = await consume(env, { event: "pull_request", delivery: "d-old", payload: prPayload(pull()) });
  const slim = useFetch(t, github(pull()));
  const b = await consume(env, { event: "pull_request", delivery: "d-old", payload: SLIM_PR });
  assert.deepEqual([a.acked, b.acked], [1, 1]);
  assert.equal(prFetches(full), 1, "the old shape's pull request is read from GitHub too");
  assert.deepEqual(trace(full), trace(slim));
});

// the red-green stage for o/r's workflow run 77 on h1, pull request 41
const RG_HEAD = "h1";
const REPORT = JSON.stringify({
  schema: "truedone.report/1", head_sha: RG_HEAD, proved_step: "1111111111111111111111111111111111111111",
  tests: [{ name: "mul multiplies", file: "test/a.test.js", condition: "lines", base: ["fail:assertion", "fail:assertion"], head: ["pass", "pass", "pass"] }],
});
const RUN_PAYLOAD = {
  action: "completed",
  workflow_run: {
    id: 77, head_sha: RG_HEAD, head_branch: "branch", conclusion: "success", display_title: "PLANTED-DISPLAY", run_attempt: 1, run_started_at: "2026-10-19T09:00:00Z",
    jobs_url: "https://api.github.com/repos/o/r/actions/runs/77/jobs", head_repository: { full_name: "o/r" },
    head_commit: { message: "PLANTED-COMMIT", author: { name: "Planted", email: "planted@example.com" } },
    actor: { login: "planted-actor" }, pull_requests: [{ number: 41 }],
  },
  repository: { ...REPO, description: "PLANTED-DESCRIPTION" }, installation: { id: 3 }, sender: { login: "planted-actor" },
};
const SLIM_RUN = {
  action: "completed", installation: { id: 3 }, repository: { id: 7, name: "r", owner: { login: "o" } },
  workflow_run: { id: 77, head_sha: RG_HEAD, head_repository: { full_name: "o/r" }, conclusion: "success", jobs_url: "https://api.github.com/repos/o/r/actions/runs/77/jobs", run_attempt: 1, run_started_at: "2026-10-19T09:00:00Z" },
};
function redGreenGitHub() {
  const pr41 = { number: 41, title: "t", body: "", user: { login: "someone", type: "User" }, changed_files: 1,
    head: { sha: RG_HEAD, ref: "branch", repo: { ...REPO, owner: { login: "o" }, name: "r", full_name: "o/r" } }, base: { sha: B, ref: "main", repo: REPO } };
  return fakeGitHub({
    api: {
      "POST /app/installations/3/access_tokens": { token: "tok" },
      [`GET /repos/o/r/commits/${RG_HEAD}/pulls`]: [pr41],
      "GET /repos/o/r/pulls/41/files": [{ filename: "test/a.test.js", status: "modified", patch: "@@ -1,1 +1,1 @@" }],
      "GET /repos/o/r/actions/runs/77/jobs": { jobs: [{ name: "test", id: 1 }] },
      "GET /repos/o/r/actions/runs/77/artifacts": { artifacts: [{ name: "truedone-report-test", expired: false, size_in_bytes: 200, archive_download_url: "https://api.github.com/z/1" }] },
      "GET /z/1": () => new Response(storedZip(REPORT)),
      "GET /repos/o/r": { default_branch: "main" },
      "GET /repos/o/r/git/ref/heads/main": { ref: "refs/heads/main", object: { sha: MAIN, type: "commit" } },
      "GET /repos/o/r/contents/.github/workflows": [{ name: "ci.yml" }],
      ...compareRoute("o", "r", B, RG_HEAD),
      ...writeRoutes("o", "r", 41, RG_HEAD),
      "GET /repos/o/r/labels": LABELS.map((l) => ({ name: l.name })),
    },
    raw: {
      [`o/r/${B}/test/a.test.js`]: TEST_BEFORE,
      [`o/r/${RG_HEAD}/test/a.test.js`]: TEST_AFTER,
      [`o/r/${MAIN}/.github/workflows/ci.yml`]: `steps:\n  - uses: truedone/truedone-action@${"1".repeat(40)} # v1\n`,
    },
  });
}

test("a workflow_run is queued slim, and the red-green stage makes the same calls and writes from it as from the full shape", async (t) => {
  useFetch(t, redGreenGitHub());
  const { env, sent } = environment();
  await worker.fetch(await signed(RUN_PAYLOAD, "workflow_run", "d-run"), env);
  assert.deepEqual(sent, [[{ event: "workflow_run", delivery: "d-run", payload: SLIM_RUN }, undefined]]);
  assert.deepEqual(planted(sent), []);
  const fromSlim = useFetch(t, redGreenGitHub());
  const a = await consume(env, sent[0][0]);
  const fromFull = useFetch(t, redGreenGitHub());
  const b = await consume(env, { event: "workflow_run", delivery: "d-run", payload: RUN_PAYLOAD });
  assert.deepEqual([a.acked, a.retried, b.acked, b.retried], [1, 0, 1, 0]);
  assert.equal(checkRuns(fromSlim).length, 1, `the check run is written: ${fromSlim.calls.map((c) => `${c.method} ${c.url}`).join(" | ")}`);
  assert.equal(labelWrites(fromSlim, 41).length, 1, "the label is written");
  assert.deepEqual(trace(fromSlim), trace(fromFull));
});

for (const queue of ["truedone-dev-dlq", "truedone-dlq"]) {
  test(`a batch from ${queue} is logged as one line of identifiers per message and acknowledged`, async (t) => {
    const fetches = [];
    useFetch(t, async (url) => { fetches.push(String(url)); return new Response("no", { status: 599 }); });
    const lines = [];
    t.mock.method(console, "error", (...args) => { lines.push(args.map(String).join(" ")); });
    t.mock.method(console, "log", (...args) => { lines.push(args.map(String).join(" ")); });
    const old = message({ event: "pull_request", delivery: "d-old", payload: prPayload(pull()) });
    old.attempts = 4;
    const run = message({ event: "workflow_run", delivery: "d-run", payload: RUN_PAYLOAD });
    await worker.queue({ queue, messages: [old, run] }, environment().env);
    assert.deepEqual([old.acked, old.retried, run.acked, run.retried], [1, 0, 1, 0]);
    assert.deepEqual(lines.map((l) => JSON.parse(l)), [
      { stage: "dead-letter", queue, delivery: "d-old", event: "pull_request", attempts: 4 },
      { stage: "dead-letter", queue, delivery: "d-run", event: "workflow_run", attempts: 1 },
    ]);
    assert.deepEqual(planted(lines), []);
    assert.deepEqual(fetches, [], "no fetch");
  });
}

for (const queue of ["truedone-dev", "truedone"]) {
  test(`a batch from ${queue} still goes to the stages`, async (t) => {
    const gh = useFetch(t, github(pull()));
    const m = await consume(environment().env, { event: "pull_request", delivery: "d-main", payload: SLIM_PR }, queue);
    assert.deepEqual([m.acked, m.retried], [1, 0]);
    assert.equal(checkRuns(gh).length, 1, "the static stage ran");
  });
}

test("wrangler.toml gives each environment's dead-letter queue that consumer, with no dead-letter queue of its own", () => {
  const text = fs.readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8");
  const blocks = [];
  let entry = null;
  for (const raw of text.split("\n")) {
    const line = raw.replace(/#.*$/, "").trim();
    const table = line.match(/^\[\[(.+)\]\]$/) ?? line.match(/^\[(.+)\]$/);
    if (table) { entry = { table: table[1] }; if (line.startsWith("[[")) blocks.push(entry); continue; }
    const kv = line.match(/^(\w+)\s*=\s*"?([^"]*)"?$/);
    if (kv && entry) entry[kv[1]] = kv[2];
  }
  const consumers = blocks.filter((b) => /(^|\.)queues\.consumers$/.test(b.table)).map((b) => [b.table, b.queue, b.dead_letter_queue ?? null]);
  assert.deepEqual(consumers, [
    ["queues.consumers", "truedone-dev", "truedone-dev-dlq"],
    ["queues.consumers", "truedone-dev-dlq", null],
    ["env.production.queues.consumers", "truedone", "truedone-dlq"],
    ["env.production.queues.consumers", "truedone-dlq", null],
  ]);
});
