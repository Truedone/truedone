import { test } from "node:test";
import assert from "node:assert/strict";
import { makeStatic } from "../src/static.mjs";
import { flagsDB, directRun } from "./lib/github.mjs";

// APP-03-AC04 (S7): a PR body with @mentions and Markdown cannot inject into the
// check-run summary. The recording-fetch fake the app tests share, inline.

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
  ];
}

function makeEnv(analyseResult) {
  const logLines = [];
  return {
    env: {
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

const PAYLOAD = { payload: { repository: { owner: { login: "o" }, name: "r", id: 7 }, installation: { id: 3 }, pull_request: { number: 1, head: { sha: "h1", ref: "main" }, base: { sha: "b1", ref: "main" }, title: "t", body: "b", user: { login: "u" } } } };

async function postedSummary(env) {
  const fetch = fakeFetch(routesFor({}));
  const oldFetch = globalThis.fetch;
  globalThis.fetch = fetch;
  try {
    await directRun(makeStatic(env), PAYLOAD);
    const created = fetch.calls.filter((c) => c.method === "POST" && c.url.includes("/check-runs"))[0];
    return JSON.parse(created.init.body).output.summary;
  } finally { globalThis.fetch = oldFetch; }
}

test("an @mention in a reason line is neutralised, not delivered", async () => {
  const { env } = makeEnv(result({ next: "@user go look" }));
  const summary = await postedSummary(env);
  assert.match(summary, /@`user/, "the mention is neutralised");
  assert.doesNotMatch(summary, /@user/, "no live mention survives");
});

test("markdown in a reason line stays literal: bold, underline, code and links", async () => {
  const { env } = makeEnv(result({ reasons: [{ check: "x", file: "test/a.test.mjs", message: "**bold** _under_ `code` [link](https://evil.example)" }] }));
  const summary = await postedSummary(env);
  assert.ok(!summary.includes("**bold**"), "bold does not render");
  assert.ok(!summary.includes("[link](https://evil.example)"), "a link does not render");
  assert.ok(!summary.includes("_under_"), "underline does not render");
});

test("a PR title or body carrying markup cannot reach the summary", async () => {
  const { env } = makeEnv(result({ next: "@owner **injected**" }));
  const summary = await postedSummary(env);
  assert.ok(!summary.includes("@owner") && !summary.includes("**injected**"), "the payload is inert");
  assert.match(summary, /@`owner/, "the mention is neutralised");
  assert.match(summary, /\\\*\\\*injected\\\*\\\*/, "the bold markup is escaped, not rendered");
});
