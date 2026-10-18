import { test } from "node:test";
import assert from "node:assert/strict";
import { makeHealth } from "../src/health.mjs";

function memoryKV() {
  const store = new Map();
  return {
    async get(k) { return store.get(k) ?? null; },
    async put(k, v) { store.set(k, v); },
  };
}

test("health answers the version and the switch, on unless it reads off", async () => {
  const r = await makeHealth({ version: "1.2.3", kv: memoryKV() })(new Request("https://app.truedone.dev/health"));
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.version, "1.2.3");
  assert.equal(body.posting_enabled, true);
});

test("health reads the global key uncached: a flip between requests is seen", async () => {
  const kv = memoryKV();
  const health = makeHealth({ version: "1", kv });
  const on = await (await health(new Request("https://app.truedone.dev/health"))).json();
  await kv.put("posting_enabled", "off");
  const off = await (await health(new Request("https://app.truedone.dev/health"))).json();
  assert.equal(on.posting_enabled, true);
  assert.equal(off.posting_enabled, false);
});

test("other paths answer 404", async () => {
  const r = await makeHealth({ version: "1", kv: memoryKV() })(new Request("https://app.truedone.dev/other"));
  assert.equal(r.status, 404);
});
