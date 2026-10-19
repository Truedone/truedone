// APP-10-AC01: the real static and red-green stages, driven through the
// consumer with faked fetch, KV and mint, reach their first GitHub write with
// the payload's repository and number. Main passed the stages the delivery id
// string, so every real delivery died at the stage (the wrangler tail line of
// 09:47Z); queue.test's fake stages hid the wiring.
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeConsumers } from "../src/index.mjs";
import { flagsDB, compareAnswer } from "./lib/github.mjs";

const API = "https://api.github.com";
const esc = (s) => s.replace(/[./]/g, "\\$&");

function memoryKV() {
  const store = new Map();
  return {
    async get(k) { return store.get(k) ?? null; },
    async put(k, v) { store.set(k, v); },
    async delete(k) { store.delete(k); },
    async list() { return { keys: [], list_complete: true, cursor: undefined }; },
  };
}

function fakeMessage(body) {
  return { body, acked: 0, retried: 0, ack() { this.acked += 1; }, retry() { this.retried += 1; } };
}

function stubFetch(t, routes) {
  const calls = [];
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    calls.push({ url: u, method: init.method || "GET", body: init.body });
    for (const [pattern, body] of routes) {
      if (pattern.test(u)) {
        return { ok: true, status: 200, json: async () => body, text: async () => String(body), arrayBuffer: async () => body };
      }
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
  t.after(() => { globalThis.fetch = orig; });
  return calls;
}

const REPO = { id: 9001, name: "truedone-sandbox", owner: { login: "mgillr" } };

test("a pull_request delivery drives the real static stage to its first GitHub write", async (t) => {
  const calls = stubFetch(t, [
    [/raw\.githubusercontent\.com/, null],
    [new RegExp(`${esc(API)}/repos/Truedone/truedone-action/tags`), []],
    [new RegExp(`${esc(API)}/repos/mgillr/truedone-sandbox/pulls/41/files`), [{ filename: "src/a.js", status: "modified", patch: "@@ -1 +1 @@\n-a\n+b" }]],
    [new RegExp(`${esc(API)}/repos/mgillr/truedone-sandbox/compare/base-41\\.\\.\\.sha-41$`), compareAnswer("base-41", "sha-41")],
    [new RegExp(`${esc(API)}/repos/mgillr/truedone-sandbox/labels`), []],
    [new RegExp(`${esc(API)}/repos/mgillr/truedone-sandbox/issues/41/labels`), []],
    [/.*/, {}],
  ]);
  const consumers = makeConsumers({ mint: async () => "tok-1" });
  const m = fakeMessage({
    event: "pull_request",
    // env.core.analyse is the real stage's local verdict pass; it reads the
    // files already fetched above and returns the verdict object the two
    // writes below carry.
    delivery: "d-fix-1",
    payload: {
      action: "opened",
      number: 41,
      repository: REPO,
      pull_request: { number: 41, title: "t", body: "", user: { login: "someone" }, head: { ref: "branch", sha: "sha-41" }, base: { ref: "main", sha: "base-41" } },
      installation: { id: 3 },
    },
  });
  await consumers.queue({ messages: [m] }, { KV: memoryKV(), FLAGS: flagsDB(), core: { analyse: async () => ({ verdict: "no_evidence", reasons: [] }) } });
  assert.equal(m.acked, 1, `the delivery is handled, retried ${m.retried}`);
  const check = calls.find((c) => c.method === "POST" && /\/repos\/mgillr\/truedone-sandbox\/check-runs$/.test(c.url));
  assert.ok(check, `the static stage posts the check run on the payload's repository; calls: ${calls.map((c) => `${c.method} ${c.url}`).join(" | ")}`);
  assert.equal(JSON.parse(check.body).head_sha, "sha-41", "the check run carries the payload's head sha");
  const label = calls.find((c) => c.method === "POST" && /\/repos\/mgillr\/truedone-sandbox\/issues\/41\/labels$/.test(c.url));
  assert.ok(label, "the static stage labels the payload's pull request number");
});

test("a workflow_run delivery drives the real red-green stage to its first GitHub write", async (t) => {
  const report = JSON.stringify({ schema: "truedone.report/1", head_sha: "h1", proved_step: "step1", tests: [{ name: "t" }] });
  const zip = new Uint8Array(22);
  const view = new DataView(zip.buffer);
  view.setUint32(0, 0x06054b50, true);
  view.setUint16(10, 1, true);
  const postChecks = [];
  const env = {
    KV: memoryKV(),
    FLAGS: flagsDB(),
    UNZIP: async () => ({ entries: [{ data: new TextEncoder().encode(report) }] }),
    defaultStepSha: async () => "step1",
    publishedShas: async () => [],
    core: { judge: () => ({ verdict: "proven" }) },
    staticResult: () => ({}),
    staticVerdict: () => "unrun",
    postCheck: async (sha, judged, meta) => postChecks.push({ sha, judged, meta }),
    postLabel: async (number, judged) => postChecks.push({ number, judged }),
  };
  stubFetch(t, [
    [new RegExp(`${esc(API)}/repos/mgillr/truedone-sandbox/commits/h1/pulls`), [{ number: 41, head: { sha: "sha-branch", repo: { owner: { login: "mgillr" }, name: "truedone-sandbox" } } }]],
    [new RegExp(`${esc(API)}/repos/mgillr/truedone-sandbox/actions/runs/77/jobs`), { jobs: [{ name: "test", id: 1 }] }],
    [new RegExp(`${esc(API)}/repos/mgillr/truedone-sandbox/actions/runs/77/artifacts`), { artifacts: [{ name: "truedone-report-test", expired: false, size_in_bytes: 22, archive_download_url: `${API}/z/1` }] }],
    [new RegExp(`${esc(API)}/z/1`), zip],
    [/.*/, {}],
  ]);
  const consumers = makeConsumers({ mint: async () => "tok-1" });
  const m = fakeMessage({
    event: "workflow_run",
    delivery: "d-2",
    payload: {
      action: "completed",
      workflow_run: { id: 77, head_sha: "h1", head_branch: "branch", conclusion: "success", jobs_url: `${API}/repos/mgillr/truedone-sandbox/actions/runs/77/jobs`, head_repository: { full_name: "mgillr/truedone-sandbox" } },
      repository: REPO,
      installation: { id: 3 },
    },
  });
  await consumers.queue({ messages: [m] }, env);
  assert.equal(m.acked, 1, `the delivery is handled, retried ${m.retried}`);
  const check = postChecks.find((p) => p.sha === "h1" && p.meta?.repo === "truedone-sandbox" && p.meta?.number === 41);
  assert.ok(check, `the red-green stage posts the check with the payload's repository and number; postChecks: ${JSON.stringify(postChecks)}`);
});
