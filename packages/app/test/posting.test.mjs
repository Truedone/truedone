import { test } from "node:test";
import assert from "node:assert/strict";
import { postingAllowed, parseConfig, deleteInstallationData } from "../src/posting.mjs";
import { flagsDB } from "./lib/github.mjs";

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

test("posting is allowed with the global row on, no installation row and no repo config; with no global row it is off", async () => {
  const r = await postingAllowed({ FLAGS: flagsDB() }, { installationId: 3, configText: undefined });
  assert.deepEqual(r, { allowed: true });
  const none = await postingAllowed({ FLAGS: flagsDB({}) }, { installationId: 3, configText: undefined });
  assert.deepEqual(none, { allowed: false, reason: "posting_disabled" });
});

test("the installation-wide flag off stops posting", async () => {
  const r = await postingAllowed({ FLAGS: flagsDB({ posting_enabled: "on", "posting_enabled:3": "off" }) }, { installationId: 3, configText: "" });
  assert.equal(r.allowed, false);
  assert.equal(r.reason, "posting_disabled");
});

test("enabled: false in the repo config stops posting for that repository", async () => {
  const r = await postingAllowed({ FLAGS: flagsDB() }, { installationId: 3, configText: "enabled: false\n" });
  assert.equal(r.allowed, false);
  assert.equal(r.reason, "repo_disabled");
});

test("the installation's row is read on every call: a second call sees the change", async () => {
  const db = flagsDB();
  const first = await postingAllowed({ FLAGS: db }, { installationId: 3, configText: "" });
  db.store.set("posting_enabled:3", "off");
  const second = await postingAllowed({ FLAGS: db }, { installationId: 3, configText: "" });
  assert.equal(first.allowed, true);
  assert.equal(second.allowed, false);
});

test("uninstall deletes the installation's keys and its switch row", async () => {
  const kv = memoryKV();
  const db = flagsDB({ posting_enabled: "on", "posting_enabled:3": "on", "posting_enabled:5": "off" });
  await kv.put("3:verdict:1", "x");
  await kv.put("3:delivery:d-1", "1");
  await kv.put("5:verdict:9", "x");
  const removed = await deleteInstallationData({ KV: kv, FLAGS: db }, 3);
  assert.equal(removed, 2, "the two installation-scoped keys");
  assert.equal([...kv.store.keys()].sort().join(","), "5:verdict:9");
  assert.deepEqual([...db.store.keys()].sort(), ["posting_enabled", "posting_enabled:5"], "the switch row is deleted with the installation");
});

test("parseConfig reads the five keys and names unknown ones", () => {
  const cfg = parseConfig("test: npm test\ncomments: off\nconclusion: neutral\nignore: dist\ncustom: 1");
  assert.equal(cfg.test, "npm test");
  assert.deepEqual(cfg.unknown, ["custom"]);
});
