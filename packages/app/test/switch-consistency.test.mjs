// APP-19 (#107): the posting switch was a Workers KV key. A KV write reaches other locations "up to 60 seconds or more"
// later and a get is cached where it was read for 60 s (Cloudflare's KV docs), so the APP-06 switch-off smoke saw
// /health read off while the App still labelled pull requests elsewhere (#126, #128). The switch is now the D1 table
// flags, which answers every location from one primary. Here two locations share one D1 database and see Workers KV
// as the docs describe it: each keeps a value it has already read. Everything goes through the Worker's own default
// export:
// - The switch written off: /health at the writer's location reads off, and a delivery at the other location, whose KV
//   still holds on, makes no GitHub write.
// - No global row: /health reads off and a delivery writes nothing, so an unseeded database never posts.
// - The installation's row off stops its delivery; with no installation row, the delivery posts.
// - The database unreachable: /health answers 503, and the delivery writes nothing and is retried.
// - The uninstall sweep deletes the installation's row.
import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.mjs";
import { LABELS } from "../src/labels.mjs";
import { fakeGitHub, writeRoutes, delivery, pkcs1Pem, flagsDB } from "./lib/github.mjs";

const B = "cccccccccccccccccccccccccccccccccccccccc";
const H = "dddddddddddddddddddddddddddddddddddddddd";
const REPO = { id: 7, name: "r", full_name: "o/r", owner: { login: "o" } };
const PULL = { number: 6, state: "open", title: "t", body: "", user: { login: "someone", type: "User" }, changed_files: 1,
  base: { ref: "main", sha: B, repo: REPO }, head: { ref: "branch", sha: H, repo: REPO } };
const FILE = "test/a.test.js";
const before = `import { test } from 'node:test';\nimport assert from 'node:assert/strict';\ntest('a', () => {\n  assert.equal(f(), 1);\n});\n`;
const after = `${before}test('a again', () => {\n  assert.equal(f(), 1);\n});\n`;
const KEY = await pkcs1Pem();

const github = () => fakeGitHub({
  api: {
    "POST /app/installations/3/access_tokens": { token: "tok" },
    "GET /repos/o/r/pulls/6/files": [{ filename: FILE, status: "modified", patch: "@@ -5,0 +6,3 @@" }],
    ...writeRoutes("o", "r", 6, H),
    "GET /repos/o/r/labels": LABELS.map((l) => ({ name: l.name })),
  },
  raw: { [`o/r/${B}/${FILE}`]: before, [`o/r/${H}/${FILE}`]: after },
});
const writes = (fake) => fake.calls.filter((c) => c.method !== "GET" && c.url.startsWith("https://api.github.com/repos/")).length;

// Workers KV as one location sees it: the shared store, with a value kept once read there
function kvAt(shared) {
  const kept = new Map();
  return {
    async get(k) {
      if (!kept.has(k)) kept.set(k, shared.has(k) ? shared.get(k) : null);
      return kept.get(k);
    },
    async put(k, v) { shared.set(k, v); kept.set(k, v); },
    async delete(k) { shared.delete(k); kept.delete(k); },
    async list({ prefix = "" } = {}) { return { keys: [...shared.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true, cursor: undefined }; },
  };
}
const env = (kv, flags) => ({ APP_ID: "12345", PRIVATE_KEY: KEY, KV: kv, FLAGS: flags, VERSION: "v" });
async function consume(e, n = 1) {
  const m = { body: { ...delivery(PULL), delivery: `d-${n}` }, acked: 0, retried: 0, ack() { this.acked += 1; }, retry() { this.retried += 1; } };
  await worker.queue({ messages: [m] }, e);
  return m;
}
const health = async (e) => {
  const r = await worker.fetch(new Request("https://truedone-dev.example/health"), e);
  return { status: r.status, body: await r.json() };
};
function useFetch(t, fake) {
  const orig = globalThis.fetch;
  globalThis.fetch = fake;
  t.after(() => { globalThis.fetch = orig; });
}

test("the switch written off: /health at the writer's location reads off, and a delivery elsewhere writes nothing", async (t) => {
  const gh = github();
  useFetch(t, gh);
  const shared = new Map([["posting_enabled", "on"]]);
  const db = flagsDB({ posting_enabled: "on" });
  const here = kvAt(shared), there = kvAt(shared);
  const first = await consume(env(there, db), 1);
  assert.equal(first.acked, 1);
  assert.ok(writes(gh) > 0, "with the switch on, the delivery posts");
  // the switch tool turns it off where it runs: the KV key as it was, and the D1 row
  await here.put("posting_enabled", "off");
  db.store.set("posting_enabled", "off");
  assert.equal((await health(env(here, db))).body.posting_enabled, false, "/health reads off");
  const posted = writes(gh);
  const second = await consume(env(there, db), 2);
  assert.equal(second.acked, 1);
  assert.equal(writes(gh), posted, "no GitHub write after /health read off");
});

test("no global row: /health reads off and a delivery writes nothing", async (t) => {
  const gh = github();
  useFetch(t, gh);
  const kv = kvAt(new Map());
  const db = flagsDB({});
  assert.deepEqual((await health(env(kv, db))).body, { version: "v", posting_enabled: false });
  const m = await consume(env(kv, db));
  assert.equal(m.acked, 1);
  assert.equal(writes(gh), 0);
});

test("the installation's row off stops its delivery; with no installation row the delivery posts", async (t) => {
  const gh = github();
  useFetch(t, gh);
  await consume(env(kvAt(new Map()), flagsDB({ posting_enabled: "on", "posting_enabled:3": "off" })));
  assert.equal(writes(gh), 0, "the installation's row off");
  await consume(env(kvAt(new Map()), flagsDB({ posting_enabled: "on", "posting_enabled:5": "off" })), 2);
  assert.ok(writes(gh) > 0, "another installation's row does not stop it");
});

test("the database unreachable: /health answers 503, and a delivery writes nothing and is retried", async (t) => {
  const gh = github();
  useFetch(t, gh);
  const kv = kvAt(new Map([["posting_enabled", "on"]]));
  const db = flagsDB({ posting_enabled: "on" }, { fail: true });
  const h = await health(env(kv, db));
  assert.equal(h.status, 503);
  assert.equal(h.body.posting_enabled, undefined);
  const m = await consume(env(kv, db));
  assert.deepEqual([m.acked, m.retried], [0, 1], "retried, not acknowledged");
  assert.equal(writes(gh), 0);
});

test("the uninstall sweep deletes the installation's switch row", async (t) => {
  useFetch(t, github());
  const shared = new Map([["removed:3", "1"], ["3:verdict:1", "x"]]);
  const db = flagsDB({ posting_enabled: "on", "posting_enabled:3": "off", "posting_enabled:5": "off" });
  await worker.scheduled({}, env(kvAt(shared), db));
  assert.deepEqual([...db.store.keys()].sort(), ["posting_enabled", "posting_enabled:5"]);
  assert.equal(shared.has("removed:3"), false, "the sweep ran");
});
