// APP-23: the intake read and wrote its KV dedupe record before it dropped anything, so the deliveries it never keeps
// still paid a KV round trip and a KV write. They are most of them: in the lead's three tails of truedone-dev, 807 of
// 960 webhook calls were not analysed (wall p50 327 ms, CPU 1 ms), since the App's own label write sends a labeled
// delivery for every pull request and each CI run sends requested and in_progress. The drops now come before the
// dedupe. Here the Worker's own default export takes signed deliveries with a KV that records every call:
// - each dropped delivery, sent once or twice, is answered 200 and dropped with no KV call, nothing queued and no fetch;
// - a kept delivery is still deduped: opened, or workflow_run completed, sent twice with one id, is queued once, and the
//   second copy reads "duplicate";
// - an unsigned delivery is refused with no KV call;
// - a body that does not parse leaves no record, so a redeliver of the same id is handled.
import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.mjs";

const SECRET = "test-secret";

function countingKV() {
  const store = new Map();
  const calls = [];
  return {
    calls,
    async get(k) { calls.push(["get", k]); return store.has(k) ? store.get(k) : null; },
    async put(k, v) { calls.push(["put", k]); store.set(k, v); },
    async delete(k) { calls.push(["delete", k]); store.delete(k); },
    async list() { calls.push(["list"]); return { keys: [], list_complete: true, cursor: undefined }; },
  };
}
function environment() {
  const sent = [];
  return { sent, env: { WEBHOOK_SECRET: SECRET, KV: countingKV(), QUEUE: { async send(b) { sent.push(b); } }, VERSION: "v" } };
}
async function signed(text, event, delivery, { sign = true } = {}) {
  const body = new TextEncoder().encode(text);
  const headers = { "content-type": "application/json", "x-github-delivery": delivery, "x-github-event": event };
  if (sign) {
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    headers["x-hub-signature-256"] = `sha256=${[...new Uint8Array(await crypto.subtle.sign("HMAC", key, body))].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
  }
  return new Request("https://truedone.dev/api/github/webhook", { method: "POST", headers, body });
}
const payload = (action) => JSON.stringify({ action, number: 6, pull_request: { number: 6 }, repository: { id: 7, name: "r", owner: { login: "o" } }, installation: { id: 3 } });
// every fetch the Worker makes is recorded and refused
function noFetch(t) {
  const calls = [];
  const orig = globalThis.fetch;
  globalThis.fetch = async (url) => { calls.push(String(url)); return new Response("no", { status: 599 }); };
  t.after(() => { globalThis.fetch = orig; });
  return calls;
}
const deliver = async (env, text, event, delivery, opts) => {
  const r = await worker.fetch(await signed(text, event, delivery, opts), env);
  return { status: r.status, text: await r.text() };
};

const DROPPED = [
  ["pull_request", "labeled", "pull_request.labeled"], ["pull_request", "unlabeled", "pull_request.unlabeled"],
  ["pull_request", "closed", "pull_request.closed"], ["pull_request", "edited", "pull_request.edited"],
  ["workflow_run", "requested", "workflow_run.requested"], ["workflow_run", "in_progress", "workflow_run.in_progress"],
  ["installation", "deleted", "installation_deleted"], ["installation_repositories", "removed", "installation_repositories_removed"],
];
for (const [event, action, dropped] of DROPPED) {
  test(`${event}.${action}, sent twice: dropped both times with no KV call, nothing queued, no fetch`, async (t) => {
    const fetches = noFetch(t);
    const { env, sent } = environment();
    for (const copy of [1, 2]) {
      const r = await deliver(env, payload(action), event, `d-${event}-${action}`);
      assert.equal(r.status, 200, `copy ${copy}`);
      assert.deepEqual(JSON.parse(r.text), { dropped }, `copy ${copy}`);
    }
    assert.deepEqual(env.KV.calls, [], "no KV get, put or delete");
    assert.deepEqual(sent, []);
    assert.deepEqual(fetches, []);
  });
}

for (const [event, action] of [["pull_request", "opened"], ["workflow_run", "completed"]]) {
  test(`${event}.${action}, sent twice with one id: queued once, the second copy a duplicate`, async (t) => {
    noFetch(t);
    const { env, sent } = environment();
    const first = await deliver(env, payload(action), event, "d-kept");
    const second = await deliver(env, payload(action), event, "d-kept");
    assert.deepEqual(JSON.parse(first.text), { queued: event });
    assert.deepEqual([second.status, second.text], [200, "duplicate"]);
    assert.equal(sent.length, 1);
    assert.deepEqual(env.KV.calls, [["get", "delivery:d-kept"], ["put", "delivery:d-kept"], ["get", "delivery:d-kept"]]);
  });
}

test("an unsigned delivery is refused with no KV call", async (t) => {
  noFetch(t);
  const { env, sent } = environment();
  const r = await deliver(env, payload("labeled"), "pull_request", "d-unsigned", { sign: false });
  assert.equal(r.status, 401);
  assert.deepEqual(env.KV.calls, []);
  assert.deepEqual(sent, []);
});

test("a body that does not parse leaves no record, so a redeliver of the same id is handled", async (t) => {
  noFetch(t);
  const { env, sent } = environment();
  await assert.rejects(worker.fetch(await signed("{not json", "pull_request", "d-broken"), env));
  assert.deepEqual(env.KV.calls, [], "nothing recorded for it");
  const again = await deliver(env, payload("opened"), "pull_request", "d-broken");
  assert.deepEqual(JSON.parse(again.text), { queued: "pull_request" });
  assert.equal(sent.length, 1);
});
