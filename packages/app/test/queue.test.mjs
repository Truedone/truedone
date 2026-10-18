import { test } from "node:test";
import assert from "node:assert/strict";
import { makeConsumers } from "../src/index.mjs";
import { sweepLeftovers } from "../src/posting.mjs";
import { flagsDB } from "./lib/github.mjs";

// APP-08-AC01: the queue handler routes a pull_request message to the static
// stage and a workflow_run message to the red-green check, acknowledges a
// handled message and retries a failed one; the scheduled handler runs the
// sweep over the removed installations.

function fakeMessage(body) {
  return { body, acked: 0, retried: 0, ack() { this.acked++; }, retry() { this.retried++; } };
}

function memoryKV() {
  const store = new Map();
  return {
    store,
    async get(k) { const e = store.get(k); return e === undefined ? null : e.v; },
    async put(k, v, opts = {}) { store.set(k, { v, ttl: opts.expirationTtl ?? null }); },
    async delete(k) { store.delete(k); },
    async list(opts = {}) { const ks = [...store.keys()].filter((k) => k.startsWith(opts.prefix)); return { keys: ks, list_complete: true, cursor: undefined }; },
  };
}

const ENV = { APP_ID: "12345", KV: memoryKV(), FLAGS: flagsDB() };

test("a pull_request message routes to the static stage and is acknowledged", async () => {
  const calls = [];
  const consumers = makeConsumers({ mint: async () => "tok-1", staticStage: async (d) => { calls.push(["static", d, "tok-1"]); }, redGreenStage: async () => { throw new Error("must not run"); } });
  const m = fakeMessage({ event: "pull_request", delivery: "d-1", payload: { repository: { id: 7 }, installation: { id: 3 } } });
  await consumers.queue({ messages: [m] }, ENV);
  assert.equal(m.acked, 1);
  assert.equal(m.retried, 0);
  assert.equal(calls[0][0], "static");
  assert.equal(calls[0][2], "tok-1", "the stage got the minted token");
  assert.equal(calls[0][1].payload.repository.id, 7, "the stage got the body's payload");
  assert.equal(calls[0][1].delivery, "d-1", "the stage got the whole body, the id included");
});

test("a workflow_run message routes to the red-green stage and is acknowledged", async () => {
  const calls = [];
  const consumers = makeConsumers({ mint: async () => "tok-2", staticStage: async () => { throw new Error("must not run"); }, redGreenStage: async (d) => { calls.push(["redgreen", d]); } });
  const m = fakeMessage({ event: "workflow_run", delivery: "d-2", payload: { action: "completed" } });
  await consumers.queue({ messages: [m] }, ENV);
  assert.equal(m.acked, 1);
  assert.equal(calls[0][0], "redgreen");
});

test("a stage failure retries the message instead of acknowledging it", async () => {
  const consumers = makeConsumers({ mint: async () => "tok-3", staticStage: async () => { throw new Error("the stage failed"); } });
  const m = fakeMessage({ event: "pull_request", delivery: "d-3", payload: {} });
  await consumers.queue({ messages: [m] }, ENV);
  assert.equal(m.retried, 1);
  assert.equal(m.acked, 0);
});

test("an unknown event is acknowledged with no stage run", async () => {
  let ran = false;
  const consumers = makeConsumers({ mint: async () => "tok-4", staticStage: async () => { ran = true; }, redGreenStage: async () => { ran = true; } });
  const m = fakeMessage({ event: "ping", delivery: "d-4", payload: {} });
  await consumers.queue({ messages: [m] }, ENV);
  assert.equal(m.acked, 1);
  assert.equal(ran, false, "no stage claimed a ping");
});

test("the scheduled handler sweeps every removed installation and clears the markers", async () => {
  const kv = ENV.KV;
  await kv.put("removed:11", "1");
  await kv.put("removed:12", "1");
  await kv.put("11:delivery:d-1", "1");
  await kv.put("12:verdict:2", "x");
  await kv.put("removed:13", "1");
  const swept = [];
  const consumers = makeConsumers({ sweep: async (env, id) => { swept.push(id); await sweepLeftovers(env, id); } });
  await consumers.scheduled({}, ENV);
  assert.deepEqual(swept.sort(), [11, 12, 13]);
  assert.equal(kv.store.has("removed:11"), false, "the sweep clears its marker");
  assert.equal(kv.store.has("11:delivery:d-1"), false);
  assert.equal(kv.store.has("12:verdict:2"), false);
});
