import { test } from "node:test";
import assert from "node:assert/strict";
import { markRemoved, sweepLeftovers } from "../src/posting.mjs";

// APP-05-AC03 (R6): uninstall deletes the installation's data at once, and the
// daily sweep catches whatever a raced delivery wrote afterwards.

function memoryKV() {
  const store = new Map();
  return {
    store,
    async get(k) { const e = store.get(k); return e === undefined ? null : e.v; },
    async put(k, v, opts = {}) { store.set(k, { v, ttl: opts.expirationTtl ?? null }); },
    async delete(k) { store.delete(k); },
    async list({ prefix }) { return [...store.keys()].filter((k) => k.startsWith(prefix)); },
  };
}

test("uninstall deletes the installation's keys and its posting flag", async () => {
  const { deleteInstallationData } = await import("../src/posting.mjs");
  const kv = memoryKV();
  await kv.put("3:verdict:1", "x");
  await kv.put("3:delivery:d-1", "1");
  await kv.put("posting_enabled:3", "on");
  await kv.put("5:verdict:9", "x");
  const removed = await deleteInstallationData({ KV: kv }, 3);
  assert.equal(removed, 2, "the two installation-scoped keys");
  assert.deepEqual([...kv.store.keys()], ["5:verdict:9"]);
  assert.equal(kv.store.has("3:verdict:1"), false);
  assert.equal(kv.store.has("posting_enabled:3"), false);
  assert.equal(kv.store.has("5:verdict:9"), true, "another installation's keys stay");
});

test("a delivery racing the uninstall leaves a key; the sweep removes it and clears the marker", async () => {
  const kv = memoryKV();
  await markRemoved({ KV: kv }, 3);
  const { deleteInstallationData } = await import("../src/posting.mjs");
  await deleteInstallationData({ KV: kv }, 3);
  await kv.put("3:delivery:d-2", "1", { expirationTtl: 86400 });
  const removed = await sweepLeftovers({ KV: kv }, 3);
  assert.equal(removed, 1, "the raced key is gone");
  assert.equal(kv.store.has("3:delivery:d-2"), false);
  assert.equal(kv.store.has("removed:3"), false, "the sweep clears the removed marker");
  const again = await sweepLeftovers({ KV: kv }, 3);
  assert.equal(again, 0, "a second sweep finds nothing");
});
