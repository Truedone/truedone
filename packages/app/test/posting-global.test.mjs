// APP-09-AC04: one global KV key, posting_enabled, read uncached before every
// write beside the per-installation key, and /health reports it from that key
// (on unless it reads off), not from an environment variable. Main read only
// the per-installation key and reported an env var.
import { test } from "node:test";
import assert from "node:assert/strict";
import { postingAllowed } from "../src/posting.mjs";
import { makeApp } from "../src/index.mjs";

function memoryKV() {
  const store = new Map();
  return {
    store,
    async get(k) { return store.get(k) ?? null; },
    async put(k, v) { store.set(k, v); },
    async delete(k) { store.delete(k); },
    async list() { return { keys: [], list_complete: true, cursor: undefined }; },
  };
}

test("the global posting_enabled key off stops every write", async () => {
  const kv = memoryKV();
  await kv.put("posting_enabled", "off");
  const r = await postingAllowed({ KV: kv }, { installationId: 3, configText: "" });
  assert.deepEqual(r, { allowed: false, reason: "posting_disabled" });
});

test("with the global key absent, posting behaves as before", async () => {
  const kv = memoryKV();
  await kv.put("posting_enabled:3", "off");
  const r = await postingAllowed({ KV: kv }, { installationId: 3, configText: "" });
  assert.deepEqual(r, { allowed: false, reason: "posting_disabled" });
  const ok = await postingAllowed({ KV: memoryKV() }, { installationId: 3, configText: "" });
  assert.deepEqual(ok, { allowed: true });
});

test("the global key is read uncached: flipping it between calls is seen", async () => {
  const kv = memoryKV();
  const first = await postingAllowed({ KV: kv }, { installationId: 3, configText: "" });
  await kv.put("posting_enabled", "off");
  const second = await postingAllowed({ KV: kv }, { installationId: 3, configText: "" });
  assert.equal(first.allowed, true);
  assert.equal(second.allowed, false);
});

test("/health reports posting_enabled from the global key, not an environment variable", async () => {
  const kv = memoryKV();
  const app = makeApp({ VERSION: "v-1", KV: kv, POSTING_ENABLED: "true" });
  const on = await app(new Request("https://app.truedone.dev/health"));
  assert.equal((await on.json()).posting_enabled, true, "on unless it reads off");
  await kv.put("posting_enabled", "off");
  const off = await app(new Request("https://app.truedone.dev/health"));
  assert.equal((await off.json()).posting_enabled, false, "the env var does not override the key");
});
