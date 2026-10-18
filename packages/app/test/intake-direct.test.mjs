// APP-17-AC01 (#108): after APP-15 and APP-16 the development App labelled at p50 4,000 ms, of which the queue's
// hand-off was 1.06 s (the lead's wrangler tail at 15:39Z). The intake now answers a pull_request delivery, then runs
// the static stage itself in ctx.waitUntil, and the queue is only its retry path. Here the Worker's own default export
// takes signed deliveries with a ctx that keeps the waitUntil promises:
// - opened: answered 200, nothing queued, and once the promises settle, one read of the files and one check run.
// - A run that throws: the delivery goes to the queue as it came, and one log line names it, without the token.
// - The same delivery id twice: analysed once.
// - A run that throws and a queue send that fails: the dedupe record is deleted, so the same delivery id again (a
//   redeliver from the App's delivery log) is analysed once.
// - workflow_run completed, a dropped action, or no ctx at all: no direct run; the first and last are queued.
// - A run that outlasts the budget: sent to the queue delayed past Cloudflare's 30 s waitUntil cut, and only once.
import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.mjs";
// a namespace import, so each test fails on its own outcome where the intake has no budget yet
import * as webhook from "../src/webhook.mjs";
import { LABELS } from "../src/labels.mjs";
import { fakeGitHub, memoryKV, writeRoutes, pkcs1Pem } from "./lib/github.mjs";

const SECRET = "test-secret";
const TOKEN = "ghs_intake_direct_token";
const B = "cccccccccccccccccccccccccccccccccccccccc";
const H = "dddddddddddddddddddddddddddddddddddddddd";
const REPO = { id: 7, name: "r", full_name: "o/r", owner: { login: "o" } };
const PULL = { number: 6, state: "open", title: "t", body: "", user: { login: "someone", type: "User" }, changed_files: 1,
  base: { ref: "main", sha: B, repo: REPO }, head: { ref: "branch", sha: H, repo: REPO } };
const FILE = "test/a.test.js";
const before = `import { test } from 'node:test';\nimport assert from 'node:assert/strict';\ntest('a', () => {\n  assert.equal(f(), 1);\n});\n`;
const after = `${before}test('a again', () => {\n  assert.equal(f(), 1);\n});\n`;

// GitHub for o/r#6, which changes one test file; filesStatus 500 makes the analysis throw
function github({ filesStatus = 200 } = {}) {
  const api = {
    "POST /app/installations/3/access_tokens": { token: TOKEN, expires_at: new Date(Date.now() + 3600_000).toISOString() },
    "GET /repos/o/r/pulls/6/files": [{ filename: FILE, status: "modified", patch: "@@ -5,0 +6,3 @@" }],
    ...writeRoutes("o", "r", 6, H),
    "GET /repos/o/r/labels": LABELS.map((l) => ({ name: l.name })),
    "PATCH /repos/o/r/issues/6": {},
    "POST /graphql": { data: { addLabelsToLabelable: { labelable: { number: 6 } } } },
  };
  const fake = fakeGitHub({ api, raw: { [`o/r/${B}/${FILE}`]: before, [`o/r/${H}/${FILE}`]: after } });
  if (filesStatus === 200) return fake;
  const f = async (url, init = {}) => (new URL(url).pathname === "/repos/o/r/pulls/6/files" ? (fake.calls.push({ url: String(url), method: "GET" }), Response.json({ message: "boom" }, { status: filesStatus })) : fake(url, init));
  f.calls = fake.calls;
  return f;
}
const payloadFor = (event, action) => ({
  action,
  ...(event === "pull_request" ? { number: 6, pull_request: PULL } : { workflow_run: { id: 9, head_sha: H, head_repository: { full_name: "o/r" } } }),
  repository: { id: REPO.id, name: REPO.name, owner: { login: "o" } },
  installation: { id: 3 },
});
async function signed(payload, event, delivery) {
  const body = new TextEncoder().encode(JSON.stringify(payload));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = [...new Uint8Array(await crypto.subtle.sign("HMAC", key, body))].map((b) => b.toString(16).padStart(2, "0")).join("");
  return new Request("https://truedone.dev/api/github/webhook", {
    method: "POST",
    headers: { "content-type": "application/json", "x-hub-signature-256": `sha256=${mac}`, "x-github-delivery": delivery, "x-github-event": event },
    body,
  });
}
const KEY = await pkcs1Pem();
// one Worker environment: KV, a queue that records each send and its options (or fails), and the App's key
function environment({ failSend = false } = {}) {
  const sent = [];
  const QUEUE = { async send(body, opts) { if (failSend) throw new Error("queue unavailable"); sent.push(opts === undefined ? [body] : [body, opts]); } };
  return { sent, env: { WEBHOOK_SECRET: SECRET, KV: memoryKV(), QUEUE, APP_ID: "12345", PRIVATE_KEY: KEY, VERSION: "v" } };
}
const context = () => { const waits = []; return { waits, waitUntil(p) { waits.push(p); } }; };
function useFetch(t, fake) {
  const orig = globalThis.fetch;
  globalThis.fetch = fake;
  t.after(() => { globalThis.fetch = orig; });
}
function captureLogs(t) {
  const lines = [];
  const saved = {};
  for (const k of ["log", "error", "warn", "info", "debug"]) { saved[k] = console[k]; console[k] = (...a) => lines.push(a.join(" ")); }
  t.after(() => Object.assign(console, saved));
  return lines;
}
const route = (c) => `${c.method} ${c.url.replace("https://api.github.com", "").replace(/\?.*$/, "")}`;
const count = (fake, r) => fake.calls.filter((c) => route(c) === r).length;
async function deliver(env, event, action, delivery, ctx) {
  const r = await worker.fetch(await signed(payloadFor(event, action), event, delivery), env, ctx);
  if (ctx) await Promise.all(ctx.waits);
  return { status: r.status, body: await r.text() };
}

test("opened: answered 200 with nothing queued, then analysed once in waitUntil", async (t) => {
  const gh = github();
  useFetch(t, gh);
  const { env, sent } = environment();
  const ctx = context();
  const r = await deliver(env, "pull_request", "opened", "d-1", ctx);
  assert.equal(r.status, 200);
  assert.deepEqual(JSON.parse(r.body), { analysing: "pull_request" });
  assert.equal(ctx.waits.length, 1, "one run in waitUntil");
  assert.deepEqual(sent, [], "nothing sent to the queue");
  assert.equal(count(gh, "GET /repos/o/r/pulls/6/files"), 1, "one read of the files");
  const checks = gh.calls.filter((c) => route(c) === "POST /repos/o/r/check-runs");
  assert.equal(checks.length, 1, "one check run");
  assert.equal(JSON.parse(checks[0].body).head_sha, H);
});

test("a run that throws: the delivery goes to the queue as it came, and one log line names it without the token", async (t) => {
  const gh = github({ filesStatus: 500 });
  useFetch(t, gh);
  const logs = captureLogs(t);
  const { env, sent } = environment();
  const ctx = context();
  const r = await deliver(env, "pull_request", "opened", "d-2", ctx);
  assert.equal(r.status, 200);
  assert.deepEqual(sent, [[{ event: "pull_request", delivery: "d-2", payload: payloadFor("pull_request", "opened") }]], "queued once, with no delay");
  assert.equal(count(gh, "POST /repos/o/r/check-runs"), 0, "nothing written");
  assert.equal(await env.KV.get("delivery:d-2"), "1", "the queue has it, so the dedupe record stays");
  const lines = logs.map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean).filter((l) => l.stage === "intake");
  assert.deepEqual(lines.map((l) => [l.stage, l.delivery]), [["intake", "d-2"]]);
  assert.match(lines[0].error, /500/);
  assert.ok(logs.every((l) => !l.includes(TOKEN)), "the token is in no log line");
});

test("the same delivery id twice: analysed once", async (t) => {
  const gh = github();
  useFetch(t, gh);
  const { env, sent } = environment();
  const first = await deliver(env, "pull_request", "opened", "d-3", context());
  const second = await deliver(env, "pull_request", "opened", "d-3", context());
  assert.equal(first.status, 200);
  assert.deepEqual([second.status, second.body], [200, "duplicate"]);
  assert.equal(count(gh, "GET /repos/o/r/pulls/6/files"), 1);
  assert.equal(count(gh, "POST /repos/o/r/check-runs"), 1);
  assert.deepEqual(sent, []);
});

test("a run that throws and a send that fails: the dedupe record goes, so a redeliver is analysed once", async (t) => {
  const logs = captureLogs(t);
  const { env } = environment({ failSend: true });
  const broken = github({ filesStatus: 500 });
  useFetch(t, broken);
  await deliver(env, "pull_request", "opened", "d-4", context());
  assert.equal(await env.KV.get("delivery:d-4"), null, "the dedupe record is deleted");
  const lines = logs.map((l) => JSON.parse(l));
  assert.deepEqual(lines.map((l) => [l.stage, l.delivery]), [["intake", "d-4"], ["intake", "d-4"]], "the failed run and the failed send");
  assert.match(lines[1].error, /queue unavailable/);
  const gh = github();
  globalThis.fetch = gh;
  const again = await deliver(env, "pull_request", "opened", "d-4", context());
  assert.deepEqual(JSON.parse(again.body), { analysing: "pull_request" }, "not dropped as a duplicate");
  assert.equal(count(gh, "POST /repos/o/r/check-runs") + count(broken, "POST /repos/o/r/check-runs"), 1, "one analysis");
  assert.ok(logs.every((l) => !l.includes(TOKEN)));
});

test("workflow_run completed, a dropped action and no ctx: no direct run", async (t) => {
  const gh = github();
  useFetch(t, gh);
  const { env, sent } = environment();
  const wf = context();
  const r1 = await deliver(env, "workflow_run", "completed", "d-5", wf);
  assert.deepEqual(JSON.parse(r1.body), { queued: "workflow_run" });
  assert.equal(wf.waits.length, 0);
  const closed = context();
  const r2 = await deliver(env, "pull_request", "closed", "d-6", closed);
  assert.deepEqual(JSON.parse(r2.body), { dropped: "pull_request.closed" });
  assert.equal(closed.waits.length, 0);
  const r3 = await deliver(env, "pull_request", "opened", "d-7", undefined);
  assert.deepEqual(JSON.parse(r3.body), { queued: "pull_request" });
  assert.deepEqual(sent.map(([b, o]) => [b.event, b.delivery, o]), [["workflow_run", "d-5", undefined], ["pull_request", "d-7", undefined]]);
  assert.deepEqual(gh.calls.map(route), [], "the intake made no GitHub call");
});

test("a run past the budget: sent to the queue once, delayed past the 30 s waitUntil cut", async () => {
  assert.equal(webhook.DIRECT_BUDGET_MS, 20_000);
  assert.equal(webhook.QUEUE_DELAY_S, 15);
  assert.ok(webhook.DIRECT_BUDGET_MS / 1000 + webhook.QUEUE_DELAY_S > 30, "the queue run starts after Cloudflare cancels the direct one");
  const sent = [];
  let finished = false;
  const run = () => new Promise((resolve) => setTimeout(() => { finished = true; resolve(); }, 150));
  const { env } = environment();
  env.QUEUE = { async send(body, opts) { sent.push([body.delivery, opts, finished]); } };
  const intake = webhook.makeIntake(env, { run, budgetMs: 30 });
  const ctx = context();
  const r = await intake(await signed(payloadFor("pull_request", "opened"), "pull_request", "d-8"), ctx);
  assert.equal(r.status, 200);
  await Promise.all(ctx.waits);
  assert.deepEqual(sent, [["d-8", { delaySeconds: 15 }, false]], "handed over at the budget, before the run finished");
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal(finished, true);
  assert.equal(sent.length, 1, "the late finish sends nothing more");
});
