import { test } from "node:test";
import assert from "node:assert/strict";
import { parseConfig } from "../src/posting.mjs";
import { makeStatic } from "../src/static.mjs";
import { flagsDB } from "./lib/github.mjs";

function fakeFetch(routes) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    const u = String(url);
    calls.push({ url: u, method: init.method || "GET", init });
    for (const [pattern, responder] of routes) {
      if (u.match(pattern)) return { ok: true, status: 200, json: async () => (typeof responder === "string" ? JSON.parse(responder) : responder), text: async () => (typeof responder === "string" ? responder : JSON.stringify(responder)) };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
  fetch.calls = calls;
  return fetch;
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

const FILES = [{ filename: "test/a.test.mjs", status: "added", patch: "@@ +1" }];
function routesFor(config) {
  return [
    [/\/pulls\/1\/files/, FILES],
    [/raw\.githubusercontent\.com\/.*truedone\.yml/, config],
    [/\/commits\/h1\/check-runs\?check_name=truedone/, { check_runs: [] }],
    [/\/labels$/, []],
  ];
}
function delivery() {
  return { payload: { repository: { owner: { login: "o" }, name: "r", id: 7 }, installation: { id: 3 }, pull_request: { number: 1, head: { sha: "h1", ref: "main" }, base: { sha: "b1", ref: "main" }, title: "t", body: "b", user: { login: "u" } } } };
}

test("the reader knows the five keys and names unknown ones", () => {
  const cfg = parseConfig("comments: on\nconclusion: fail-on-tampered\nenabled: true\nignore: dist/**\ntest: npm test\nmystery: yes");
  assert.equal(cfg.comments, "on");
  assert.equal(cfg.conclusion, "fail-on-tampered");
  assert.equal(cfg.enabled, "true");
  assert.equal(cfg.ignore, "dist/**");
  assert.equal(cfg.test, "npm test");
  assert.deepEqual(cfg.unknown, ["mystery"]);
});

test("an absent config file means the defaults", () => {
  const cfg = parseConfig(undefined);
  assert.equal(cfg.comments, undefined);
  assert.equal(cfg.enabled, undefined);
  assert.deepEqual(cfg.unknown, []);
});

test("enabled: false stops the run before anything is fetched or posted", async () => {
  const fetch = fakeFetch(routesFor("enabled: false\ntest: npm test\n"));
  const oldFetch = globalThis.fetch;
  globalThis.fetch = fetch;
  try {
    const { env } = { env: { INSTALLATION_TOKEN: "t", KV: memoryKV(), FLAGS: flagsDB(), core: { analyse: async () => { throw new Error("must not run"); } } } };
    const r = await makeStatic(env)(delivery());
    assert.equal(r.skipped, "repo_disabled");
    assert.equal(fetch.calls.filter((c) => c.url.includes("/check-runs")).length, 0, "nothing is posted");
    assert.equal(fetch.calls.filter((c) => c.url.includes("raw.githubusercontent") && c.url.includes("a.test.mjs")).length, 0, "no file contents are fetched");
  } finally { globalThis.fetch = oldFetch; }
});

test("an unparsable line is skipped, not fatal", () => {
  const cfg = parseConfig("this line has no colon\ncomments: on");
  assert.equal(cfg.comments, "on");
});
