import { test } from "node:test";
import assert from "node:assert/strict";
import { makeStatic } from "../src/static.mjs";
import { flagsDB, directRun, compareAnswer } from "./lib/github.mjs";

// A recording fetch fake: every call is answered from routes and remembered.
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

const PR_FILES = [
  { filename: "src/a.mjs", status: "modified", patch: "@@ -1 +1 @@" },
  { filename: "test/a.test.mjs", status: "added", patch: "@@ +1" },
  { filename: "test/b.test.mjs", status: "added", patch: "@@ +1" },
  { filename: "jest.config.js", status: "modified", patch: "@@ -1 +1 @@" },
];

function routesFor({ analyseResult }) {
  return [
    [/\/pulls\/1\/files/, PR_FILES],
    [/\/commits\/h1\/check-runs\?check_name=truedone/, { check_runs: [] }],
    [/repos\/o\/r\/check-runs$/, { id: 100 }],
    [/\/labels$/, []],
    [/\/compare\/b1\.\.\.h1$/, compareAnswer("b1", "h1")],
  ];
}

function makeEnv(analyseResult) {
  const logLines = [];
  return {
    env: {
      // the App's own id, which the Worker holds (APP-30: a check run is the App's own only when its app.id is this)
      APP_ID: "12345",
      INSTALLATION_TOKEN: "t",
      KV: memoryKV(),
      FLAGS: flagsDB(),
      core: { analyse: async () => analyseResult },
      LOG: (l) => logLines.push(l),
    },
    logLines,
  };
}

function result(over = {}) {
  return { schema: "truedone.verdict/1", verdict: "proven", label: null, partial: false, reasons: [{ check: "x", file: "test/a.test.mjs", message: "it fails on base" }], next: "nothing", ...over };
}

test("a recorded PR gets one check run named truedone, neutral, with its reason and the page link", async () => {
  const fetch = fakeFetch(routesFor({}));
  const oldFetch = globalThis.fetch;
  globalThis.fetch = fetch;
  try {
    const { env } = makeEnv(result());
    await directRun(makeStatic(env), { payload: { repository: { owner: { login: "o" }, name: "r", id: 7 }, installation: { id: 3 }, pull_request: { number: 1, head: { sha: "h1", ref: "main" }, base: { sha: "b1", ref: "main" }, title: "t", body: "b", user: { login: "u" } } } });
    const created = fetch.calls.filter((c) => c.method === "POST" && c.url.includes("/check-runs"));
    assert.equal(created.length, 1, "exactly one check run is created");
    const body = JSON.parse(created[0].init.body);
    assert.equal(body.name, "truedone");
    assert.equal(body.head_sha, "h1");
    assert.equal(body.conclusion, "neutral", "the conclusion stays neutral by default");
    assert.match(body.output.summary, /proven/);
    assert.match(body.output.summary, /it fails on base/);
    assert.match(body.output.summary, /https:\/\/truedone\.pages\.dev\/o\/r\/pull\/1/);
  } finally { globalThis.fetch = oldFetch; }
});

test("only test, setup, config and workflow contents are fetched; raw contents come from the raw host", async () => {
  const fetch = fakeFetch(routesFor({}));
  const oldFetch = globalThis.fetch;
  globalThis.fetch = fetch;
  try {
    const { env } = makeEnv(result());
    await directRun(makeStatic(env), { payload: { repository: { owner: { login: "o" }, name: "r", id: 7 }, installation: { id: 3 }, pull_request: { number: 1, head: { sha: "h1", ref: "main" }, base: { sha: "b1", ref: "main" }, title: "t", body: "b", user: { login: "u" } } } });
    const raws = fetch.calls.filter((c) => c.url.includes("raw.githubusercontent")).map((c) => c.url);
    assert.ok(raws.length > 0, "changed test and config files are fetched from the raw host");
    assert.ok(!raws.some((u) => u.includes("src/a.mjs")), "plain source contents are never fetched");
  } finally { globalThis.fetch = oldFetch; }
});

test("an existing check run is updated in place, not created twice", async () => {
  const routes = routesFor({});
  routes[1] = [/\/commits\/h1\/check-runs\?check_name=truedone/, { check_runs: [{ id: 99, app: { id: 12345 } }] }];
  routes.push([/repos\/o\/r\/check-runs\/99$/, { id: 99 }]);
  const fetch = fakeFetch(routes);
  const oldFetch = globalThis.fetch;
  globalThis.fetch = fetch;
  try {
    const { env } = makeEnv(result());
    try {
      await directRun(makeStatic(env), { payload: { repository: { owner: { login: "o" }, name: "r", id: 7 }, installation: { id: 3 }, pull_request: { number: 1, head: { sha: "h1", ref: "main" }, base: { sha: "b1", ref: "main" }, title: "t", body: "b", user: { login: "u" } } } });
    } catch (e) {
      console.error("CALLS:", JSON.stringify(fetch.calls.map((c) => c.method + " " + c.url), null, 1));
      throw e;
    }
    assert.equal(fetch.calls.filter((c) => c.method === "POST" && c.url.endsWith("/check-runs")).length, 0, "no second run is created");
    assert.equal(fetch.calls.filter((c) => c.method === "PATCH" && c.url.includes("/check-runs/99")).length, 1, "the existing run is patched");
  } finally { globalThis.fetch = oldFetch; }
});

test("exactly one truedone label sits on the PR and the old one is replaced", async () => {
  const routes = routesFor({});
  routes.unshift([/\/issues\/1\/labels$/, [{ name: "truedone:no-evidence" }]]);
  const fetch = fakeFetch(routes);
  const oldFetch = globalThis.fetch;
  globalThis.fetch = fetch;
  try {
    const { env } = makeEnv(result());
    await directRun(makeStatic(env), { payload: { repository: { owner: { login: "o" }, name: "r", id: 7 }, installation: { id: 3 }, pull_request: { number: 1, head: { sha: "h1", ref: "main" }, base: { sha: "b1", ref: "main" }, title: "t", body: "b", user: { login: "u" } } } });
    assert.equal(fetch.calls.filter((c) => c.method === "DELETE" && c.url.includes("labels/truedone%3Ano-evidence")).length, 1, "the old label is removed");
    assert.equal(fetch.calls.filter((c) => c.method === "POST" && c.url.endsWith("/labels") && c.url.includes("issues")).length, 1, "the new label is set");
  } finally { globalThis.fetch = oldFetch; }
});

test("a not-applicable verdict removes any truedone label and sets none", async () => {
  const routes = routesFor({});
  routes.unshift([/\/issues\/1\/labels$/, [{ name: "truedone:yes" }]]);
  const fetch = fakeFetch(routes);
  const oldFetch = globalThis.fetch;
  globalThis.fetch = fetch;
  try {
    const { env } = makeEnv(result({ verdict: "not_applicable" }));
    await directRun(makeStatic(env), { payload: { repository: { owner: { login: "o" }, name: "r", id: 7 }, installation: { id: 3 }, pull_request: { number: 1, head: { sha: "h1", ref: "main" }, base: { sha: "b1", ref: "main" }, title: "t", body: "b", user: { login: "u" } } } });
    assert.equal(fetch.calls.filter((c) => c.method === "DELETE" && c.url.includes("labels/truedone%3Ayes")).length, 1);
    assert.equal(fetch.calls.filter((c) => c.method === "POST" && c.url.includes("issues/1/labels")).length, 0, "no label is added");
  } finally { globalThis.fetch = oldFetch; }
});
