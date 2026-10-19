// APP-17-AC02 (#108): every delivery minted a new installation token, part of the consumer's 1.2 s on the lead's
// 15:39Z tail. The token is now kept in KV per installation until five minutes before GitHub's expires_at:
// - A second delivery for the same installation, in the intake or through the queue, makes no mint call.
// - A kept token with four minutes left is minted again, and the new one is kept for its life less five minutes.
// - A token GitHub answers 401 is deleted, in the intake and in the queue consumer, and the retry, delayed 60 s so KV's
//   per-colo cache of the deleted token has expired, mints a new one.
// - An answer without expires_at is not kept.
// - No token appears in any log line, on any of these paths.
import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.mjs";
import { LABELS } from "../src/labels.mjs";
import { fakeGitHub, writeRoutes, pkcs1Pem, flagsDB, compareRoute } from "./lib/github.mjs";

const SECRET = "test-secret";
const NEW = "ghs_minted_now_token";
const OLD = "ghs_four_minutes_left";
const REVOKED = "ghs_revoked_token";
const B = "cccccccccccccccccccccccccccccccccccccccc";
const H = "dddddddddddddddddddddddddddddddddddddddd";
const REPO = { id: 7, name: "r", full_name: "o/r", owner: { login: "o" } };
const PULL = { number: 6, state: "open", title: "t", body: "", user: { login: "someone", type: "User" }, changed_files: 1,
  base: { ref: "main", sha: B, repo: REPO }, head: { ref: "branch", sha: H, repo: REPO } };
const FILE = "test/a.test.js";
const before = `import { test } from 'node:test';\nimport assert from 'node:assert/strict';\ntest('a', () => {\n  assert.equal(f(), 1);\n});\n`;
const after = `${before}test('a again', () => {\n  assert.equal(f(), 1);\n});\n`;
const inMinutes = (m) => new Date(Date.now() + m * 60_000).toISOString();

// GitHub for o/r#6; the mint answers NEW (with expires_at an hour ahead unless told otherwise), and every API call
// made with the REVOKED token answers 401
function github({ expires = true } = {}) {
  const fake = fakeGitHub({
    api: {
      "POST /app/installations/3/access_tokens": expires ? { token: NEW, expires_at: inMinutes(60) } : { token: NEW },
      // APP-25: a queued run reads the pull request from GitHub
      "GET /repos/o/r/pulls/6": PULL,
      "GET /repos/o/r/pulls/6/files": [{ filename: FILE, status: "modified", patch: "@@ -5,0 +6,3 @@" }],
      ...compareRoute("o", "r", B, H),
      ...writeRoutes("o", "r", 6, H),
      "GET /repos/o/r/labels": LABELS.map((l) => ({ name: l.name })),
    },
    raw: { [`o/r/${B}/${FILE}`]: before, [`o/r/${H}/${FILE}`]: after },
  });
  const f = async (url, init = {}) => {
    const auth = Object.entries(init.headers ?? {}).find(([k]) => k.toLowerCase() === "authorization")?.[1] ?? "";
    if (String(url).startsWith("https://api.github.com/repos/") && auth.includes(REVOKED)) {
      fake.calls.push({ url: String(url), method: init.method || "GET", headers: { ...init.headers } });
      return Response.json({ message: "Bad credentials" }, { status: 401 });
    }
    return fake(url, init);
  };
  f.calls = fake.calls;
  return f;
}
// KV that keeps each put's expirationTtl
function kv() {
  const store = new Map();
  const ttl = new Map();
  return {
    store, ttl,
    async get(k) { return store.has(k) ? store.get(k) : null; },
    async put(k, v, opts = {}) { store.set(k, v); ttl.set(k, opts.expirationTtl ?? null); },
    async delete(k) { store.delete(k); ttl.delete(k); },
    async list() { return { keys: [], list_complete: true, cursor: undefined }; },
  };
}
const KEY = await pkcs1Pem();
function environment(store = kv()) {
  const sent = [];
  return { sent, env: { WEBHOOK_SECRET: SECRET, KV: store, FLAGS: flagsDB(), QUEUE: { async send(b, opts) { sent.push({ body: b, opts }); } }, APP_ID: "12345", PRIVATE_KEY: KEY, VERSION: "v" } };
}
const payload = () => ({ action: "opened", number: 6, pull_request: PULL, repository: { id: 7, name: "r", owner: { login: "o" } }, installation: { id: 3 } });
async function signed(delivery) {
  const body = new TextEncoder().encode(JSON.stringify(payload()));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = [...new Uint8Array(await crypto.subtle.sign("HMAC", key, body))].map((b) => b.toString(16).padStart(2, "0")).join("");
  return new Request("https://truedone.dev/api/github/webhook", {
    method: "POST",
    headers: { "content-type": "application/json", "x-hub-signature-256": `sha256=${mac}`, "x-github-delivery": delivery, "x-github-event": "pull_request" },
    body,
  });
}
// one delivery through the intake, its waitUntil run settled
async function deliver(env, delivery) {
  const waits = [];
  const r = await worker.fetch(await signed(delivery), env, { waitUntil: (p) => waits.push(p) });
  await Promise.all(waits);
  return r.status;
}
// one queued message through the consumer
async function consume(env, body) {
  const m = { body, acked: 0, retried: 0, retries: [], ack() { this.acked += 1; }, retry(opts) { this.retried += 1; this.retries.push(opts); } };
  await worker.queue({ messages: [m] }, env);
  return m;
}
function useFetch(t, fake) {
  const orig = globalThis.fetch;
  globalThis.fetch = fake;
  t.after(() => { globalThis.fetch = orig; });
}
// every console line, so each test can show no token is in one
const logs = [];
for (const k of ["log", "error", "warn", "info", "debug"]) { const orig = console[k]; console[k] = (...a) => { logs.push(a.join(" ")); if (process.env.SHOW_LOGS) orig(...a); }; }
const route = (c) => `${c.method} ${c.url.replace("https://api.github.com", "").replace(/\?.*$/, "")}`;
const mints = (fake) => fake.calls.filter((c) => route(c) === "POST /app/installations/3/access_tokens").length;
const checkRuns = (fake) => fake.calls.filter((c) => route(c) === "POST /repos/o/r/check-runs" || route(c).startsWith("PATCH /repos/o/r/check-runs/"));
const bearer = (c) => Object.entries(c.headers ?? {}).find(([k]) => k.toLowerCase() === "authorization")?.[1];

test("a second delivery for the same installation, in the intake or through the queue, makes no mint call", async (t) => {
  const gh = github();
  useFetch(t, gh);
  const { env } = environment();
  assert.equal(await deliver(env, "d-1"), 200);
  assert.equal(await deliver(env, "d-2"), 200);
  const m = await consume(env, { event: "pull_request", delivery: "d-3", payload: payload() });
  assert.equal(m.acked, 1);
  assert.equal(mints(gh), 1, "one mint for three analyses");
  assert.equal(gh.calls.filter((c) => route(c) === "GET /repos/o/r/pulls/6/files").length, 3, "three analyses");
  assert.deepEqual([...new Set(checkRuns(gh).map(bearer))], [`Bearer ${NEW}`]);
});

test("a kept token with four minutes left is minted again, and the new one is kept for its life less five minutes", async (t) => {
  const gh = github();
  useFetch(t, gh);
  const store = kv();
  await store.put("token:3", JSON.stringify({ token: OLD, expires_at: inMinutes(4) }), { expirationTtl: 60 });
  const { env } = environment(store);
  await deliver(env, "d-4");
  assert.equal(mints(gh), 1);
  // the published release tags are read without a token; every call that carries one carries the new one
  const authed = gh.calls.filter((c) => c.url.startsWith("https://api.github.com/repos/") && bearer(c));
  assert.ok(authed.length >= 3, `${authed.length} calls with a token`);
  assert.deepEqual([...new Set(authed.map(bearer))], [`Bearer ${NEW}`]);
  assert.equal(JSON.parse(store.store.get("token:3")).token, NEW);
  const ttl = store.ttl.get("token:3");
  assert.ok(ttl >= 3600 - 300 - 5 && ttl <= 3600 - 300, `kept for ${ttl} s`);
});

test("a token GitHub answers 401 in the intake is deleted, and the retry, queued 60 s later, mints a new one", async (t) => {
  const gh = github();
  useFetch(t, gh);
  const store = kv();
  await store.put("token:3", JSON.stringify({ token: REVOKED, expires_at: inMinutes(50) }), { expirationTtl: 2700 });
  const { env, sent } = environment(store);
  await deliver(env, "d-5");
  assert.equal(mints(gh), 0, "the kept token was used");
  assert.equal(store.store.has("token:3"), false, "the refused token is deleted");
  assert.equal(sent.length, 1, "the delivery went to the queue");
  assert.deepEqual(sent[0].opts, { delaySeconds: 60 }, "after KV's 60 s cache of the deleted token");
  const m = await consume(env, sent[0].body);
  assert.equal(m.acked, 1);
  assert.equal(mints(gh), 1, "the retry minted");
  assert.equal(checkRuns(gh).length, 1);
  assert.equal(bearer(checkRuns(gh)[0]), `Bearer ${NEW}`);
});

test("a token GitHub answers 401 in the queue consumer is deleted, and the retry waits 60 s", async (t) => {
  const gh = github();
  useFetch(t, gh);
  const store = kv();
  await store.put("token:3", JSON.stringify({ token: REVOKED, expires_at: inMinutes(50) }), { expirationTtl: 2700 });
  const { env } = environment(store);
  const body = { event: "pull_request", delivery: "d-6", payload: payload() };
  const first = await consume(env, body);
  assert.deepEqual([first.acked, first.retried], [0, 1]);
  assert.deepEqual(first.retries, [{ delaySeconds: 60 }]);
  assert.equal(store.store.has("token:3"), false);
  const second = await consume(env, body);
  assert.deepEqual([second.acked, mints(gh)], [1, 1]);
});

test("an answer without expires_at is not kept", async (t) => {
  const gh = github({ expires: false });
  useFetch(t, gh);
  const store = kv();
  const { env } = environment(store);
  await deliver(env, "d-7");
  await deliver(env, "d-8");
  assert.equal(mints(gh), 2);
  assert.equal(store.store.has("token:3"), false);
});

test("no token appears in any log line", () => {
  assert.ok(logs.length > 0, "the 401 paths logged");
  for (const token of [NEW, OLD, REVOKED]) assert.ok(logs.every((l) => !l.includes(token)), `${token} logged`);
});
