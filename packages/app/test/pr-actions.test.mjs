// APP-16-AC01 (#111): on mgillr/truedone-sandbox the App rewrote #190's check run 81 s after it opened, after the pull
// request had closed. The intake queued every delivery, so a closed pull request was analysed again, and the App's own
// label write sent a pull_request.labeled delivery that ran a second analysis. Here the Worker's own default export
// takes signed deliveries. closed, labeled, edited, assigned and review_requested are answered 200 and dropped: nothing
// is sent to the queue and nothing is fetched. So are workflow_run requested and in_progress, which the red-green stage
// never judges; completed is still queued. opened, synchronize and reopened are each queued once, and each queued
// message, consumed, analyses once: one read of the pull request's files and one check run written at its head.
import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.mjs";
import { LABELS } from "../src/labels.mjs";
import { fakeGitHub, memoryKV, writeRoutes, pkcs1Pem, flagsDB } from "./lib/github.mjs";

const SECRET = "test-secret";
const B = "cccccccccccccccccccccccccccccccccccccccc";
const H = "dddddddddddddddddddddddddddddddddddddddd";
const REPO = { id: 7, name: "r", full_name: "o/r", owner: { login: "o" } };
const PULL = { number: 6, state: "open", title: "t", body: "", user: { login: "someone", type: "User" }, changed_files: 1,
  base: { ref: "main", sha: B, repo: REPO }, head: { ref: "branch", sha: H, repo: REPO } };
const FILE = "test/a.test.js";
const before = `import { test } from 'node:test';\nimport assert from 'node:assert/strict';\ntest('a', () => {\n  assert.equal(f(), 1);\n});\n`;
const after = `${before}test('a again', () => {\n  assert.equal(f(), 1);\n});\n`;

// GitHub for o/r#6, which changes one test file and gains a case; the repository defines every truedone label.
const github = () => fakeGitHub({
  api: {
    "POST /app/installations/3/access_tokens": { token: "tok" },
    "GET /repos/o/r/pulls/6/files": [{ filename: FILE, status: "modified", patch: "@@ -5,0 +6,3 @@" }],
    ...writeRoutes("o", "r", 6, H),
    "GET /repos/o/r/labels": LABELS.map((l) => ({ name: l.name })),
  },
  raw: { [`o/r/${B}/${FILE}`]: before, [`o/r/${H}/${FILE}`]: after },
});
const payloadFor = (event, action) => ({
  action,
  ...(event === "pull_request"
    ? { number: 6, pull_request: PULL }
    : { workflow_run: { id: 9, head_sha: H, conclusion: null, head_repository: { full_name: "o/r" } } }),
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
// every fetch the Worker makes goes to the fake and is recorded
function useFetch(t, fake) {
  const orig = globalThis.fetch;
  globalThis.fetch = fake;
  t.after(() => { globalThis.fetch = orig; });
}
// one delivery through the Worker's fetch handler: its answer, and what it sent to the queue
async function deliver(event, action) {
  const sent = [];
  const env = { WEBHOOK_SECRET: SECRET, KV: memoryKV(), FLAGS: flagsDB(), QUEUE: { async send(m) { sent.push(m); } }, VERSION: "v" };
  const r = await worker.fetch(await signed(payloadFor(event, action), event, `d-${event}-${action}`), env);
  return { status: r.status, body: await r.json(), sent };
}
// one queued message through the Worker's queue handler
async function consume(body) {
  const m = { body, acked: 0, retried: 0, ack() { this.acked += 1; }, retry() { this.retried += 1; } };
  await worker.queue({ messages: [m] }, { APP_ID: "12345", PRIVATE_KEY: await pkcs1Pem(), KV: memoryKV(), FLAGS: flagsDB(), VERSION: "v" });
  assert.equal(m.acked, 1, `handled, retried ${m.retried}`);
}
const route = (c) => `${c.method} ${c.url.replace("https://api.github.com", "").replace(/\?.*$/, "")}`;

for (const [event, action] of [
  ["pull_request", "closed"], ["pull_request", "labeled"], ["pull_request", "edited"], ["pull_request", "assigned"],
  ["pull_request", "review_requested"], ["workflow_run", "requested"], ["workflow_run", "in_progress"],
]) {
  test(`${event}.${action}: answered 200 and dropped, nothing queued, nothing fetched`, async (t) => {
    const gh = github();
    useFetch(t, gh);
    const r = await deliver(event, action);
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { dropped: `${event}.${action}` });
    assert.deepEqual(r.sent, []);
    assert.deepEqual(gh.calls.map(route), []);
  });
}

test("workflow_run.completed is still queued", async (t) => {
  const gh = github();
  useFetch(t, gh);
  const r = await deliver("workflow_run", "completed");
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { queued: "workflow_run" });
  assert.equal(r.sent.length, 1);
  assert.equal(r.sent[0].payload.action, "completed");
  assert.deepEqual(gh.calls.map(route), []);
});

for (const action of ["opened", "synchronize", "reopened"]) {
  test(`pull_request.${action}: queued once, and consumed it analyses once`, async (t) => {
    const gh = github();
    useFetch(t, gh);
    const r = await deliver("pull_request", action);
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { queued: "pull_request" });
    assert.equal(r.sent.length, 1);
    assert.deepEqual(gh.calls.map(route), [], "the intake fetches nothing");
    await consume(r.sent[0]);
    const calls = gh.calls.map(route);
    assert.equal(calls.filter((c) => c === "GET /repos/o/r/pulls/6/files").length, 1, "one read of the files");
    const checks = gh.calls.filter((c) => route(c) === "POST /repos/o/r/check-runs");
    assert.equal(checks.length, 1, "one check run written");
    assert.equal(JSON.parse(checks[0].body).head_sha, H);
  });
}

// a closed delivery queued before the intake dropped it: the stage makes no read and no write
test("a closed pull_request message already in the queue: only the token is minted", async (t) => {
  const gh = github();
  useFetch(t, gh);
  await consume({ event: "pull_request", delivery: "d-old", payload: payloadFor("pull_request", "closed") });
  assert.deepEqual(gh.calls.map(route), ["POST /app/installations/3/access_tokens"]);
});
