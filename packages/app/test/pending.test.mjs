import { test } from "node:test";
import assert from "node:assert/strict";
import { makeRedGreen } from "../src/redgreen.mjs";

// APP-04-AC04: a held first-time-contributor run (conclusion action_required)
// gives Waiting for approval and fetches nothing further.

test("a held run returns the pending verdict without taking a report", async () => {
  const calls = [];
  const fetch = async (url) => {
    calls.push(String(url));
    const u = String(url);
    if (u.includes("/commits/h1/pulls")) {
      return { ok: true, status: 200, json: async () => [{ number: 2, head: { repo: { owner: { login: "truedone" }, name: "truedone" } } }] };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  };
  const oldFetch = globalThis.fetch;
  globalThis.fetch = fetch;
  try {
    const env = {
      INSTALLATION_TOKEN: "t",
      defaultStepSha: async () => { throw new Error("must not read steps"); },
      publishedShas: async () => { throw new Error("must not read releases"); },
      core: { judge: async () => { throw new Error("must not judge"); } },
      staticResult: () => ({}),
      staticVerdict: () => null,
      postCheck: async () => { throw new Error("must not post"); },
      postLabel: async () => { throw new Error("must not label"); },
    };
    const out = await makeRedGreen(env)({ payload: { action: "completed", workflow_run: { id: 9, head_sha: "h1", conclusion: "action_required", pull_requests: [], head_repository: { full_name: "truedone/truedone" } }, repository: { owner: { login: "o" }, name: "r", id: 7 }, installation: { id: 3 } } });
    assert.equal(out.verdict, "pending");
    assert.equal(out.pr, 2);
    assert.ok(!calls.some((c) => c.includes("/actions/runs")), "no artifact was taken");
  } finally { globalThis.fetch = oldFetch; }
});
