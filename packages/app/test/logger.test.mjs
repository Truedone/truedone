import { test } from "node:test";
import assert from "node:assert/strict";
import { makeStatic } from "../src/static.mjs";

// APP-03-AC05 (S8): the Worker logs installation id, repository id, PR number,
// verdict and timings, never diff content, file contents or PR text.

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
    async list({ prefix }) { return [...store.keys()].filter((k) => k.startsWith(prefix)); },
  };
}

const PR_FILES = [
  { path: "src/a.mjs", status: "modified", patch: "@@ -1 +1 @@ secret-diff-line" },
  { path: "test/a.test.mjs", status: "added", patch: "@@ +1" },
  { path: "test/b.test.mjs", status: "added", patch: "@@ +1" },
  { path: "jest.config.js", status: "modified", patch: "@@ -1 +1 @@" },
];

function routesFor({ analyseResult }) {
  return [
    [/\/pulls\/1\/files/, PR_FILES],
    [/\/commits\/h1\/check-runs\?check_name=truedone/, { check_runs: [] }],
    [/repos\/o\/r\/check-runs$/, { id: 100 }],
    [/\/labels$/, []],
  ];
}

function makeEnv(analyseResult) {
  const logLines = [];
  return {
    env: {
      INSTALLATION_TOKEN: "t",
      KV: memoryKV(),
      core: { analyse: async () => analyseResult },
      LOG: (l) => logLines.push(l),
    },
    logLines,
  };
}

function result(over = {}) {
  return { schema: "truedone.verdict/1", verdict: "proven", label: null, partial: false, reasons: [{ check: "x", file: "test/a.test.mjs", message: "it fails on base" }], next: "nothing", ...over };
}

test("the log carries the ids, the verdict and timings", async () => {
  const fetch = fakeFetch(routesFor({}));
  const oldFetch = globalThis.fetch;
  globalThis.fetch = fetch;
  try {
    const { env, logLines } = makeEnv(result({ verdict: "review" }));
    await makeStatic(env)({ payload: { repository: { owner: { login: "o" }, name: "r", id: 7 }, installation: { id: 3 }, pull_request: { number: 1, head: { sha: "h1", ref: "main" }, title: "t", body: "b", user: { login: "u" } } } });
    assert.equal(logLines.length, 1);
    assert.equal(logLines[0].installation, 3);
    assert.equal(logLines[0].repository, 7);
    assert.equal(logLines[0].pr, 1);
    assert.equal(logLines[0].verdict, "review");
    assert.equal(typeof logLines[0].ms, "number");
  } finally { globalThis.fetch = oldFetch; }
});

test("the log never carries PR text, file contents or diff content", async () => {
  const fetch = fakeFetch(routesFor({}));
  const oldFetch = globalThis.fetch;
  globalThis.fetch = fetch;
  try {
    const { env, logLines } = makeEnv(result({ reasons: [{ check: "x", file: "test/a.test.mjs", message: "mentions secret-message" }] }));
    await makeStatic(env)({ payload: { repository: { owner: { login: "o" }, name: "r", id: 7 }, installation: { id: 3 }, pull_request: { number: 1, head: { sha: "h1", ref: "main" }, title: "secret-title", body: "secret-body", user: { login: "u" } } } });
    const text = JSON.stringify(logLines);
    assert.ok(!text.includes("secret-title") && !text.includes("secret-body"), "no PR text is logged");
    assert.ok(!text.includes("secret-diff-line"), "no diff content is logged");
    assert.ok(!text.includes("@@"), "no patch hunk is logged");
  } finally { globalThis.fetch = oldFetch; }
});
