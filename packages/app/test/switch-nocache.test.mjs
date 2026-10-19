import { test } from "node:test";
import assert from "node:assert/strict";
import { makeStatic } from "../src/static.mjs";
import { flagsDB, directRun, compareAnswer } from "./lib/github.mjs";

// APP-05-AC02 (R5): the flag is read with no cache. The same env flips the flag
// between two deliveries; the second delivery must see the fresh value.

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

function fakeFetch(routes) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    const u = String(url);
    calls.push({ url: u, method: init.method || "GET", init });
    for (const [pattern, responder] of routes) {
      if (u.match(pattern)) {
        const body = typeof responder === "function" ? responder(u, init) : responder;
        return { ok: true, status: 200, json: async () => (typeof body === "string" ? JSON.parse(body) : body), text: async () => (typeof body === "string" ? body : JSON.stringify(body)) };
      }
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
  fetch.calls = calls;
  return fetch;
}

const PR_FILES = [
  { filename: "src/a.mjs", status: "modified", patch: "@@ -1 +1 @@" },
  { filename: "test/a.test.mjs", status: "added", patch: "@@ +1" },
];

function routesFor({ analyseResult }) {
  return [
    [/\.github\/truedone\.yml$/, ""],
    [/\/pulls\/1\/files/, PR_FILES],
    [/\/compare\/b1\.\.\.h1$/, compareAnswer("b1", "h1")],
    [/\/commits\/h1\/check-runs\?check_name=truedone/, { check_runs: [] }],
    [/repos\/o\/r\/check-runs$/, { id: 100 }],
    [/\/labels$/, []],
  ];
}

function result(over = {}) {
  return { schema: "truedone.verdict/1", verdict: "proven", label: null, partial: false, reasons: [{ check: "x", file: "test/a.test.mjs", message: "it fails on base" }], next: "nothing", ...over };
}

const PAYLOAD = { payload: { repository: { owner: { login: "o" }, name: "r", id: 7 }, installation: { id: 3 }, pull_request: { number: 1, head: { sha: "h1", ref: "main" }, base: { sha: "b1", ref: "main" }, title: "t", body: "b", user: { login: "u" } } } };

test("a delivery after the flag flips sees the fresh value and stops", async () => {
  const kv = memoryKV();
  const fetch = fakeFetch(routesFor({}));
  const oldFetch = globalThis.fetch;
  globalThis.fetch = fetch;
  try {
    const db = flagsDB();
    const env = { INSTALLATION_TOKEN: "t", KV: kv, FLAGS: db, core: { analyse: async () => result() } };
    const stage = makeStatic(env);
    const first = await directRun(stage, PAYLOAD);
    assert.equal(first.verdict, "proven", "the first delivery posts");
    const posted = fetch.calls.filter((c) => c.method === "POST").length;
    assert.ok(posted > 0, "the first delivery wrote to GitHub");
    db.store.set("posting_enabled:3", "off");
    const second = await directRun(stage, PAYLOAD);
    assert.deepEqual(second, { skipped: "posting_disabled" }, "the second delivery reads the flag uncached");
    assert.equal(fetch.calls.filter((c) => c.method === "POST").length, posted, "no new writes after the switch");
  } finally { globalThis.fetch = oldFetch; }
});
