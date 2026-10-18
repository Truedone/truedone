import { test } from "node:test";
import assert from "node:assert/strict";
import { makeRedGreen } from "../src/redgreen.mjs";

// APP-04-AC03 (D10): a report cannot override the static Tampered or
// Test changes: review verdicts.

function makeZipOneEntry(fileName, text) {
  const enc = new TextEncoder();
  const name = enc.encode(fileName);
  const data = enc.encode(text);
  const u16 = (v) => new Uint8Array([v & 255, (v >> 8) & 255]);
  const u32 = (v) => new Uint8Array([v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255]);
  const local = new Uint8Array(30 + name.length);
  local.set(u32(0x04034b50), 0);
  local.set(u16(name.length), 26);
  local.set(name, 30);
  const central = new Uint8Array(46 + name.length);
  central.set(u32(0x02014b50), 0);
  central.set(u16(name.length), 28);
  central.set(u32(0), 42);
  central.set(name, 46);
  const end = new Uint8Array(22);
  end.set(u32(0x06054b50), 0);
  end.set(u16(1), 10);
  const out = new Uint8Array(local.length + data.length + central.length + end.length);
  let o = 0;
  out.set(local, o); o += local.length;
  out.set(data, o); o += data.length;
  out.set(central, o); o += central.length;
  out.set(end, o);
  return out;
}

const REPORT = JSON.stringify({ schema: "truedone.report/1", head_sha: "h1", proved_step: "step1", tests: [{ file: "t", name: "t", base: ["fail:assertion", "fail:assertion"], head: ["pass", "pass", "pass"], condition: "lines", asserts_new_symbol: false, duration_ms: 1 }] });

function makeEnv(staticVerdict) {
  const state = { posts: 0, labels: 0, judged: 0 };
  const env = {
    state,
    INSTALLATION_TOKEN: "t",
    defaultStepSha: async () => "step1",
    publishedShas: async () => [],
    core: { judge: async () => { state.judged++; return { schema: "truedone.verdict/1", verdict: "proven", partial: false, reasons: [], next: null }; } },
    staticResult: () => ({}),
    staticVerdict,
    postCheck: async () => { state.posts++; },
    postLabel: async () => { state.labels++; },
    UNZIP: async (buf) => {
      const text = new TextDecoder().decode(buf).slice(30 + "report.json".length, 30 + "report.json".length + REPORT.length);
      return { entries: [{ data: new TextEncoder().encode(text) }] };
    },
  };
  return env;
}

const PAYLOAD = { payload: { action: "completed", workflow_run: { id: 9, head_sha: "h1", conclusion: "success", pull_requests: [], head_repository: { full_name: "truedone/truedone" } }, repository: { owner: { login: "o" }, name: "r", id: 7 }, installation: { id: 3 } } };

async function runWith(staticVerdict) {
  const env = makeEnv(staticVerdict);
  const zip = makeZipOneEntry("report.json", REPORT);
  const fetch = async (url) => {
    const u = String(url);
    if (u.includes("/actions/runs/9/artifacts")) {
      return { ok: true, status: 200, json: async () => ({ artifacts: [{ name: "truedone-report-test", expired: false, size_in_bytes: zip.length, archive_download_url: "https://dl.example/1" }] }) };
    }
    if (u.includes("/commits/h1/pulls")) {
      return { ok: true, status: 200, json: async () => [{ number: 2, head: { repo: { owner: { login: "truedone" }, name: "truedone" } } }] };
    }
    return { ok: true, status: 200, arrayBuffer: async () => zip.buffer };
  };
  const oldFetch = globalThis.fetch;
  globalThis.fetch = fetch;
  try {
    const out = await makeRedGreen(env)(PAYLOAD);
    return { out, state: env.state };
  } finally { globalThis.fetch = oldFetch; }
}

test("a valid report cannot move a static tampered verdict", async () => {
  const { out, state } = await runWith(() => "tampered");
  assert.equal(out.verdict, "tampered");
  assert.equal(state.posts, 0, "no check run carries the report's verdict");
  assert.equal(state.labels, 0, "no label carries the report's verdict");
});

test("a valid report cannot move a static review verdict", async () => {
  const { out, state } = await runWith(() => "review");
  assert.equal(out.verdict, "review");
  assert.equal(state.posts, 0);
  assert.equal(state.labels, 0);
});
