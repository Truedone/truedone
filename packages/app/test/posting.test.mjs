import { test } from "node:test";
import assert from "node:assert/strict";
import { postingAllowed, parseConfig, deleteInstallationData } from "../src/posting.mjs";

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

test("posting is allowed by default: no flag, no repo config", async () => {
  const r = await postingAllowed({ KV: memoryKV() }, { installationId: 3, configText: undefined });
  assert.deepEqual(r, { allowed: true });
});

test("the installation-wide flag off stops posting", async () => {
  const kv = memoryKV();
  await kv.put("posting_enabled:3", "off");
  const r = await postingAllowed({ KV: kv }, { installationId: 3, configText: "" });
  assert.equal(r.allowed, false);
  assert.equal(r.reason, "posting_disabled");
});

test("enabled: false in the repo config stops posting for that repository", async () => {
  const r = await postingAllowed({ KV: memoryKV() }, { installationId: 3, configText: "enabled: false\n" });
  assert.equal(r.allowed, false);
  assert.equal(r.reason, "repo_disabled");
});

test("the flag is read uncached: a second call sees the change", async () => {
  const kv = memoryKV();
  const first = await postingAllowed({ KV: kv }, { installationId: 3, configText: "" });
  await kv.put("posting_enabled:3", "off");
  const second = await postingAllowed({ KV: kv }, { installationId: 3, configText: "" });
  assert.equal(first.allowed, true);
  assert.equal(second.allowed, false);
});

test("uninstall deletes the installation's keys and its posting flag", async () => {
  const kv = memoryKV();
  await kv.put("3:verdict:1", "x");
  await kv.put("3:delivery:d-1", "1");
  await kv.put("posting_enabled:3", "on");
  await kv.put("5:verdict:9", "x");
  const removed = await deleteInstallationData({ KV: kv }, 3);
  assert.equal(removed, 2, "the two installation-scoped keys");
  assert.equal([...kv.store.keys()].sort().join(","), "5:verdict:9", "the posting flag is deleted with the installation");
});

test("parseConfig reads the five keys and names unknown ones", () => {
  const cfg = parseConfig("test: npm test\ncomments: off\nconclusion: neutral\nignore: dist\ncustom: 1");
  assert.equal(cfg.test, "npm test");
  assert.deepEqual(cfg.unknown, ["custom"]);
});
