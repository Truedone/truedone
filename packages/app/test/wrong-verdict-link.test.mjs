// COLLECT-02-AC01 (D39): every check run summary ends with the wrong-verdict
// issue form, prefilled with the repository, the pull request number, both
// commits, the verdict, the reason codes and the App's version, and holds no
// pull request title, body or author. The link is built from what the stage
// already holds; no read is added. The recording-fetch fake the app tests
// share, inline, as in escape.test.mjs.
import { test } from "node:test";
import { flagsDB, directRun, compareAnswer } from "./lib/github.mjs";

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
    async get(k) { const e = store.get(k); return e === undefined ? null : e.v; },
    async put(k, v, opts = {}) { store.set(k, { v, ttl: opts.expirationTtl ?? null }); },
    async delete(k) { store.delete(k); },
    async list(opts = {}) { const ks = [...store.keys()].filter((k) => k.startsWith(opts.prefix)); return { keys: ks, list_complete: true, cursor: undefined }; },
  };
}

const PR_FILES = [
  { filename: "src/a.mjs", status: "modified", patch: "@@ -1 +1 @@" },
  { filename: "test/a.test.mjs", status: "added", patch: "@@ +1" },
];

function routesFor() {
  return [
    [/\/pulls\/1\/files/, PR_FILES],
    [/\/compare\/b1\.\.\.h1$/, compareAnswer("b1", "h1")],
    [/\/commits\/h1\/check-runs\?check_name=truedone/, { check_runs: [] }],
    [/repos\/o\/r\/check-runs$/, { id: 100 }],
    [/\/labels$/, []],
  ];
}

function makeEnv(analyseResult) {
  return {
    env: {
      INSTALLATION_TOKEN: "t",
      VERSION: "0.1.0-test",
      KV: memoryKV(),
      FLAGS: flagsDB(),
      core: { analyse: async () => analyseResult },
      LOG: () => {},
    },
  };
}

function result(over = {}) {
  return { schema: "truedone.verdict/1", verdict: "proven", label: null, partial: false, reasons: [{ check: "x", file: "test/a.test.mjs", message: "it fails on base" }], next: "nothing", ...over };
}

const PAYLOAD = { payload: { repository: { owner: { login: "o" }, name: "r", id: 7 }, installation: { id: 3 }, pull_request: { number: 1, head: { sha: "h1", ref: "main" }, base: { sha: "b1", ref: "main" }, title: "injected title", body: "injected body", user: { login: "someuser", type: "User" } } } };

async function postedSummary(env) {
  const fetch = fakeFetch(routesFor());
  const oldFetch = globalThis.fetch;
  globalThis.fetch = fetch;
  try {
    const { makeStatic } = await import("../src/static.mjs");
    await directRun(makeStatic(env), PAYLOAD);
    const created = fetch.calls.filter((c) => c.method === "POST" && c.url.includes("/check-runs"))[0];
    return JSON.parse(created.init.body).output.summary;
  } finally {
    globalThis.fetch = oldFetch;
  }
}

test("the summary ends with the wrong-verdict link, filled from what the stage holds", async () => {
  const summary = await postedSummary(makeEnv(result()).env);
  const m = summary.match(/\[This verdict is wrong\]\((https:\/\/github\.com\/Truedone\/truedone\/issues\/new\?[^)\s]+)\)\n?$/);
  if (!m) throw new Error(`the summary does not end with the wrong-verdict link:\n${summary}`);
  const params = new URL(m[1]).searchParams;
  const want = {
    template: "wrong-verdict.yml",
    pr: "https://github.com/o/r/pull/1",
    head: "h1",
    base: "b1",
    verdict: "proven",
    reasons: "x",
    version: "0.1.0-test",
  };
  for (const [k, v] of Object.entries(want)) {
    if (params.get(k) !== v) throw new Error(`${k} is ${JSON.stringify(params.get(k))}, want ${JSON.stringify(v)}`);
  }
});

test("the summary holds no pull request title, body or author", async () => {
  const summary = await postedSummary(makeEnv(result()).env);
  for (const text of ["injected title", "injected body", "someuser"]) {
    if (summary.includes(text)) throw new Error(`the summary carries pull request text: ${text}`);
  }
});

test("the reason codes dedupe and keep their order", async () => {
  const summary = await postedSummary(makeEnv(result({ reasons: [{ check: "weakened", message: "a" }, { check: "no_test", message: "b" }, { check: "weakened", message: "c" }] })).env);
  const m = summary.match(/issues\/new\?[^)\s]+/);
  const params = new URL("https://github.com/Truedone/truedone/" + m[0].slice("/".length)).searchParams;
  const got = params.get("reasons");
  if (got !== "weakened,no_test") throw new Error(`reasons is ${JSON.stringify(got)}, want "weakened,no_test"`);
});
