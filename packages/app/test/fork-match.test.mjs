import { test } from "node:test";
import assert from "node:assert/strict";
import { makeRedGreen } from "../src/redgreen.mjs";

// APP-04-AC01 (PV-A05): the workflow_run payload carries an empty pull_requests
// list for a fork, so the PR is matched by head SHA and head repository.

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

const PRS = [
  { number: 1, head: { repo: { owner: { login: "someone" }, name: "flock" } } },
  { number: 2, head: { repo: { owner: { login: "truedone" }, name: "truedone" } } },
];

function routesFor() {
  return [
    [/\/commits\/h1\/pulls/, PRS],
    [/\/actions\/runs\/9\/artifacts/, { artifacts: [] }],
  ];
}

function makeEnv() {
  return {
    INSTALLATION_TOKEN: "t",
    defaultStepSha: async () => "step1",
    publishedShas: async () => [],
    core: { judge: async () => { throw new Error("must not judge"); } },
    staticResult: () => ({}),
    staticVerdict: () => null,
    postCheck: async () => { throw new Error("must not post"); },
    postLabel: async () => { throw new Error("must not label"); },
  };
}

const RUN = { id: 9, head_sha: "h1", conclusion: "success", pull_requests: [] };

test("a fork's run matches its PR by head sha and head repository", async () => {
  const fetch = fakeFetch(routesFor());
  const oldFetch = globalThis.fetch;
  globalThis.fetch = fetch;
  try {
    const stage = makeRedGreen(makeEnv());
    const out = await stage({ payload: { action: "completed", workflow_run: { ...RUN, head_repository: { full_name: "truedone/truedone" } }, repository: { owner: { login: "o" }, name: "r", id: 7 }, installation: { id: 3 } } });
    assert.equal(out.skipped, "no_report", "the PR matched; the run simply has no report artifact");
    assert.ok(fetch.calls.some((c) => c.url.includes("/commits/h1/pulls")), "the PR list was queried by head sha");
  } finally { globalThis.fetch = oldFetch; }
});

test("a run whose head repository is another fork attaches to no PR", async () => {
  const others = [{ number: 2, head: { repo: { owner: { login: "truedone" }, name: "truedone" } } }];
  const fetch = fakeFetch([[/\/commits\/h1\/pulls/, others], [/\/actions\/runs\/9\/artifacts/, { artifacts: [] }]]);
  const oldFetch = globalThis.fetch;
  globalThis.fetch = fetch;
  try {
    const stage = makeRedGreen(makeEnv());
    const out = await stage({ payload: { action: "completed", workflow_run: { ...RUN, head_repository: { full_name: "someone/flock" } }, repository: { owner: { login: "o" }, name: "r", id: 7 }, installation: { id: 3 } } });
    assert.equal(out.skipped, "no_pr", "the head repository must match exactly");
  } finally { globalThis.fetch = oldFetch; }
});
