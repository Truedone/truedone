import { test } from "node:test";
import assert from "node:assert/strict";
import { makeStatic } from "../src/static.mjs";
import { flagsDB, directRun } from "./lib/github.mjs";

// APP-05-AC01 (R5): with posting_enabled off nothing is posted (the D1 rows since APP-19), and
// enabled: false stops one repository.

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

function routesFor({ configText = "", analyseResult } = {}) {
  return [
    [/\.github\/truedone\.yml$/, configText],
    [/\/pulls\/1\/files/, PR_FILES],
    [/\/commits\/h1\/check-runs\?check_name=truedone/, { check_runs: [] }],
    [/repos\/o\/r\/check-runs$/, { id: 100 }],
    [/\/labels$/, []],
  ];
}

function result(over = {}) {
  return { schema: "truedone.verdict/1", verdict: "proven", label: null, partial: false, reasons: [{ check: "x", file: "test/a.test.mjs", message: "it fails on base" }], next: "nothing", ...over };
}

const PAYLOAD = { payload: { repository: { owner: { login: "o" }, name: "r", id: 7 }, installation: { id: 3 }, pull_request: { number: 1, head: { sha: "h1", ref: "main" }, base: { sha: "b1", ref: "main" }, title: "t", body: "b", user: { login: "u" } } } };

test("with posting_enabled off nothing is posted and nothing is fetched", async () => {
  const kv = memoryKV();
  const db = flagsDB({ posting_enabled: "on", "posting_enabled:3": "off" });
  const fetch = fakeFetch(routesFor({}));
  const oldFetch = globalThis.fetch;
  globalThis.fetch = fetch;
  try {
    const env = { INSTALLATION_TOKEN: "t", KV: kv, FLAGS: db, core: { analyse: async () => result() } };
    const out = await directRun(makeStatic(env), PAYLOAD);
    assert.deepEqual(out, { skipped: "posting_disabled" });
    assert.equal(fetch.calls.filter((c) => c.method !== "GET").length, 0, "nothing was posted, edited or deleted");
  } finally { globalThis.fetch = oldFetch; }
});

test("enabled: false in the repo config stops that repository alone", async () => {
  const kv = memoryKV();
  const fetch = fakeFetch(routesFor({ configText: "enabled: false\n" }));
  const oldFetch = globalThis.fetch;
  globalThis.fetch = fetch;
  try {
    const env = { INSTALLATION_TOKEN: "t", KV: kv, FLAGS: flagsDB(), core: { analyse: async () => result() } };
    const out = await directRun(makeStatic(env), PAYLOAD);
    assert.deepEqual(out, { skipped: "repo_disabled" });
    assert.equal(fetch.calls.length, 1, "only the config file was read");
    assert.ok(!fetch.calls.some((c) => c.method === "POST"), "nothing was posted");
  } finally { globalThis.fetch = oldFetch; }
});

test("flag on and config silent: the run posts", async () => {
  const kv = memoryKV();
  const fetch = fakeFetch(routesFor({}));
  const oldFetch = globalThis.fetch;
  globalThis.fetch = fetch;
  try {
    const env = { INSTALLATION_TOKEN: "t", KV: kv, FLAGS: flagsDB(), core: { analyse: async () => result() } };
    const out = await directRun(makeStatic(env), PAYLOAD);
    assert.equal(out.verdict, "proven");
    assert.ok(fetch.calls.some((c) => c.method === "POST" && c.url.includes("/check-runs")), "the check run was posted");
  } finally { globalThis.fetch = oldFetch; }
});
