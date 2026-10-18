import { test } from "node:test";
import assert from "node:assert/strict";
import { makeIntake, verifySignature } from "../src/webhook.mjs";

const SECRET = "test-secret";

function memoryKV() {
  const store = new Map();
  return {
    store,
    async get(k) { return store.get(k) ?? null; },
    async put(k, v, opts = {}) { store.set(k, { v, ttl: opts.expirationTtl ?? null }); },
  };
}
function memoryQueue() {
  const messages = [];
  return { messages, async send(m) { messages.push(m); } };
}
const env = () => ({ WEBHOOK_SECRET: SECRET, KV: memoryKV(), QUEUE: memoryQueue() });

async function signedRequest(payload, { event = "pull_request", delivery = "d-1", secret = SECRET, signature } = {}) {
  const body = new TextEncoder().encode(JSON.stringify(payload));
  let mac = "";
  if (signature !== null) {
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    mac = "sha256=" + [...new Uint8Array(await crypto.subtle.sign("HMAC", key, body))].map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  const headers = { "content-type": "application/json" };
  if (signature !== null) headers["x-hub-signature-256"] = signature ?? mac;
  if (delivery !== null) headers["x-github-delivery"] = delivery;
  headers["x-github-event"] = event;
  return new Request("https://truedone.dev/api/github/webhook", { method: "POST", headers, body });
}

test("a non-webhook path answers 404", async () => {
  const intake = makeIntake(env());
  const r = await intake(new Request("https://truedone.dev/other", { method: "POST", body: "x" }));
  assert.equal(r.status, 404);
});

test("a missing signature header answers 401 and queues nothing", async () => {
  const e = env();
  const intake = makeIntake(e);
  const r = await intake(await signedRequest({ a: 1 }, { signature: null }));
  assert.equal(r.status, 401);
  assert.equal(e.QUEUE.messages.length, 0);
});

test("a wrong signature answers 401", async () => {
  const intake = makeIntake(env());
  const r = await intake(await signedRequest({ a: 1 }, { signature: "sha256=" + "0".repeat(64) }));
  assert.equal(r.status, 401);
});

test("a signature without the sha256 prefix answers 401", async () => {
  const intake = makeIntake(env());
  const r = await intake(await signedRequest({ a: 1 }, { signature: "md5=deadbeef" }));
  assert.equal(r.status, 401);
});

test("a signature made with the wrong secret answers 401", async () => {
  const intake = makeIntake(env());
  const r = await intake(await signedRequest({ a: 1 }, { secret: "other-secret" }));
  assert.equal(r.status, 401);
});

test("a correct signature is acknowledged and queued", async () => {
  const e = env();
  const intake = makeIntake(e);
  const r = await intake(await signedRequest({ action: "opened", number: 1 }));
  assert.equal(r.status, 200);
  assert.equal(e.QUEUE.messages.length, 1);
  assert.equal(e.QUEUE.messages[0].event, "pull_request");
  assert.equal(e.QUEUE.messages[0].payload.number, 1);
});

test("a missing delivery id answers 400", async () => {
  const e = env();
  const intake = makeIntake(e);
  const r = await intake(await signedRequest({ a: 1 }, { delivery: null }));
  assert.equal(r.status, 400);
  assert.equal(e.QUEUE.messages.length, 0);
});

test("a repeated delivery id is dropped and queues once", async () => {
  const e = env();
  const intake = makeIntake(e);
  const first = await intake(await signedRequest({ action: "opened" }));
  const second = await intake(await signedRequest({ action: "opened" }));
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(e.QUEUE.messages.length, 1);
});

test("the dedupe record carries the 24 hour ttl", async () => {
  const e = env();
  const intake = makeIntake(e);
  await intake(await signedRequest({ a: 1 }));
  const rec = [...e.KV.store.values()][0];
  assert.equal(rec.ttl, 24 * 60 * 60);
});

test("an installation deleted event is dropped without queuing", async () => {
  const e = env();
  const intake = makeIntake(e);
  const r = await intake(await signedRequest({ action: "deleted" }, { event: "installation", delivery: "d-del" }));
  assert.equal(r.status, 200);
  assert.equal(e.QUEUE.messages.length, 0);
  assert.ok([...e.KV.store.keys()][0].startsWith("delivery:"));
});

test("an installation_repositories removed event is dropped without queuing", async () => {
  const e = env();
  const intake = makeIntake(e);
  const r = await intake(await signedRequest({ action: "removed" }, { event: "installation_repositories", delivery: "d-rem" }));
  assert.equal(r.status, 200);
  assert.equal(e.QUEUE.messages.length, 0);
});

test("a workflow_run event queues with its delivery", async () => {
  const e = env();
  const intake = makeIntake(e);
  const r = await intake(await signedRequest({ action: "completed", workflow_run: { id: 9 } }, { event: "workflow_run", delivery: "d-wf" }));
  assert.equal(r.status, 200);
  assert.equal(e.QUEUE.messages[0].delivery, "d-wf");
});

test("verifySignature accepts its own mac and refuses a tampered body", async () => {
  const body = new TextEncoder().encode(JSON.stringify({ a: 1 }));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = "sha256=" + [...new Uint8Array(await crypto.subtle.sign("HMAC", key, body))].map((b) => b.toString(16).padStart(2, "0")).join("");
  assert.equal(await verifySignature(SECRET, body, mac), true);
  assert.equal(await verifySignature(SECRET, new TextEncoder().encode(JSON.stringify({ a: 2 })), mac), false);
});
