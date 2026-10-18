import { test } from "node:test";
import assert from "node:assert/strict";
import { reportChecks, makeRedGreen } from "../src/redgreen.mjs";

// APP-04-AC02 (PV-A06): reports for another SHA, from an edited step, oversized,
// multi-file or of another shape are refused before any of it is believed.

const base = { schema: "truedone.report/1", head_sha: "h1", proved_step: "step1", tests: [{ name: "t" }] };

test("a non-json report is refused", () => {
  assert.equal(reportChecks("not json", { headSha: "h1" }).why, "not json");
});

test("a report of another schema is refused", () => {
  assert.equal(reportChecks(JSON.stringify({ ...base, schema: "proved.report/1" }), { headSha: "h1" }).why, "schema");
});

test("a report for another SHA is refused", () => {
  assert.equal(reportChecks(JSON.stringify({ ...base, head_sha: "h2" }), { headSha: "h1" }).why, "head_sha");
});

test("a report from an edited step that matches neither main nor a published release is refused", () => {
  assert.equal(reportChecks(JSON.stringify(base), { headSha: "h1", defaultBranchStep: "other", publishedShas: ["pub1"] }).why, "proved_step");
  assert.equal(reportChecks(JSON.stringify(base), { headSha: "h1", defaultBranchStep: "step1", publishedShas: ["pub1"] }).ok, true);
  assert.equal(reportChecks(JSON.stringify(base), { headSha: "h1", defaultBranchStep: "other", publishedShas: ["pub1", "step1"] }).ok, true);
});

test("a report with more than 500 tests is refused", () => {
  const big = { ...base, tests: Array.from({ length: 501 }, (_, i) => ({ name: `t${i}` })) };
  assert.equal(reportChecks(JSON.stringify(big), { headSha: "h1", defaultBranchStep: "step1" }).why, "tests");
});

// The multi-file refusal is exercised through the real artifact path: a zip whose
// end-of-central-directory declares two entries is refused before any unzip call.
function eocd(entries) {
  const buf = new Uint8Array(22);
  const v = new DataView(buf.buffer);
  v.setUint32(0, 0x06054b50, true);
  v.setUint16(10, entries, true);
  return buf;
}

function makeEnv(artifactBody) {
  const calls = [];
  return {
    calls,
    INSTALLATION_TOKEN: "t",
    defaultStepSha: async () => "step1",
    publishedShas: async () => [],
    core: { judge: async () => { throw new Error("must not judge"); } },
    staticResult: () => ({}),
    staticVerdict: () => null,
    postCheck: async () => { throw new Error("must not post"); },
    postLabel: async () => { throw new Error("must not label"); },
    fetch2: artifactBody,
  };
}

test("an artifact declaring two entries is refused before any unzip", async () => {
  const env = makeEnv(eocd(2));
  const body = env.fetch2;
  const fetch = async (url, init = {}) => {
    const u = String(url);
    env.calls.push(u);
    if (u.includes("/commits/h1/pulls")) {
      return { ok: true, status: 200, json: async () => [{ number: 2, head: { repo: { owner: { login: "truedone" }, name: "truedone" } } }] };
    }
    if (u.includes("/actions/runs/9/artifacts")) {
      return { ok: true, status: 200, json: async () => ({ artifacts: [{ name: "truedone-report-test", expired: false, size_in_bytes: 100, archive_download_url: "https://dl.example/1" }] }) };
    }
    return { ok: true, status: 200, arrayBuffer: async () => body.buffer };
  };
  env.UNZIP = async () => { throw new Error("unzip must not run"); };
  const oldFetch = globalThis.fetch;
  globalThis.fetch = fetch;
  try {
    const stage = makeRedGreen(env);
    await assert.rejects(
      stage({ payload: { action: "completed", workflow_run: { id: 9, head_sha: "h1", conclusion: "success", pull_requests: [], head_repository: { full_name: "truedone/truedone" } }, repository: { owner: { login: "o" }, name: "r", id: 7 }, installation: { id: 3 } } }),
      /artifact holds 2 files/,
    );
    assert.ok(!env.calls.includes("unzip"), "no unzip call was made");
  } finally { globalThis.fetch = oldFetch; }
});
