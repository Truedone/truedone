// APP-12-AC01: the Worker's own default export, with only fetch, KV and the
// message faked, updates the check run and the label from a recorded
// workflow_run delivery and its report artifact. Production set none of the
// red-green stage's eight (core, UNZIP, defaultStepSha, postCheck, postLabel,
// publishedShas, staticResult, staticVerdict), so every workflow_run delivery
// would have died the way the static stage's did before APP-11.
import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.mjs";

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

async function generatedPkcs1Pem() {
  const pair = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  );
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
  const der = pkcs8.slice(26); // the PKCS#8 header is 26 bytes; the rest is the PKCS#1 DER
  let bin = "";
  for (let i = 0; i < der.length; i += 0x8000) bin += String.fromCharCode.apply(null, der.subarray(i, i + 0x8000));
  return `-----BEGIN RSA PRIVATE KEY-----\n${btoa(bin)}\n-----END RSA PRIVATE KEY-----`;
}

const REPORT = JSON.stringify({
  schema: "truedone.report/1",
  head_sha: "h1",
  proved_step: "1111111111111111111111111111111111111111",
  tests: [{ name: "mul multiplies", file: "node-test/smoke.test.mjs", condition: "lines", base: ["fail:assertion", "fail:assertion"], head: ["pass", "pass", "pass"] }],
});

// A real minimal stored zip (method 0, no crc use) holding one entry whose
// data is the report text, so the stage's S6 check and the Web API unzip both
// see an honest artifact.
function reportZip(text) {
  const name = "r";
  const data = new TextEncoder().encode(text);
  const local = new Uint8Array(30 + name.length + data.length);
  const lv = new DataView(local.buffer);
  lv.setUint32(0, 0x04034b50, true);
  lv.setUint16(4, 20, true);
  lv.setUint16(8, 0, true); // stored
  lv.setUint32(18, data.length, true);
  lv.setUint32(22, data.length, true);
  lv.setUint16(26, name.length, true);
  local.set(new TextEncoder().encode(name), 30);
  local.set(data, 30 + name.length);
  const cdOffset = local.length;
  const central = new Uint8Array(46 + name.length);
  const cv = new DataView(central.buffer);
  cv.setUint32(0, 0x02014b50, true);
  cv.setUint16(4, 20, true);
  cv.setUint16(6, 20, true);
  cv.setUint16(10, 0, true);
  cv.setUint32(20, data.length, true);
  cv.setUint32(24, data.length, true);
  cv.setUint16(28, name.length, true);
  cv.setUint32(42, 0, true);
  central.set(new TextEncoder().encode(name), 46);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, 1, true);
  ev.setUint16(10, 1, true);
  ev.setUint32(12, central.length, true);
  ev.setUint32(16, cdOffset, true);
  const out = new Uint8Array(local.length + central.length + 22);
  out.set(local, 0);
  out.set(central, local.length);
  out.set(eocd, local.length + central.length);
  return out;
}
const ZIP = reportZip(REPORT);

const PAYLOAD = {
  action: "completed",
  workflow_run: {
    id: 77,
    head_sha: "h1",
    head_branch: "branch",
    conclusion: "success",
    jobs_url: `${API}/repos/mgillr/truedone-sandbox/actions/runs/77/jobs`,
    head_repository: { full_name: "mgillr/truedone-sandbox" },
  },
  repository: { id: 9001, name: "truedone-sandbox", owner: { login: "mgillr" } },
  installation: { id: 3 },
};

test("the entry's queue handler updates the check run and the label for a recorded workflow_run", async (t) => {
  const calls = [];
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    calls.push({ url: u, method: init.method || "GET", body: init.body });
    const routes = [
      [new RegExp(`${esc(API)}/app/installations/3/access_tokens`), { token: "tok-1" }],
      [new RegExp(`${esc(API)}/repos/mgillr/truedone-sandbox/commits/h1/pulls`), [{ number: 41, title: "t", body: "", user: { login: "someone" }, head: { sha: "h1", ref: "branch", repo: { owner: { login: "mgillr" }, name: "truedone-sandbox" } }, base: { sha: "base-41", ref: "main" } }]],
      [new RegExp(`${esc(API)}/repos/mgillr/truedone-sandbox/pulls/41/files`), [{ filename: "test/a.test.js", status: "modified", patch: "@@ -1,3 +1,3 @@" }]],
      [/raw\.githubusercontent\.com\/mgillr\/truedone-sandbox\/base-41\//, "const a = 1;\n"],
      [/raw\.githubusercontent\.com\/mgillr\/truedone-sandbox\/(h1|branch|sha-branch)\//, "const a = 2;\n"],
      [new RegExp(`${esc(API)}/repos/truedone/action/tags`), []],
      [new RegExp(`${esc(API)}/repos/mgillr/truedone-sandbox/actions/runs/77/jobs`), { jobs: [{ name: "test", id: 1 }] }],
      [new RegExp(`${esc(API)}/repos/mgillr/truedone-sandbox/actions/runs/77/artifacts`), { artifacts: [{ name: "truedone-report-test", expired: false, size_in_bytes: 22, archive_download_url: `${API}/z/1` }] }],
      [new RegExp(`${esc(API)}/z/1`), ZIP],
      [new RegExp(`${esc(API)}/repos/mgillr/truedone-sandbox$`), { default_branch: "main" }],
      [new RegExp(`${esc(API)}/repos/mgillr/truedone-sandbox/contents/.github/workflows`), [{ name: "ci.yml" }]],
      [/raw\.githubusercontent\.com\/mgillr\/truedone-sandbox\/main\/\.github\/workflows\/ci\.yml/, `steps:\n  - uses: mgillr/truedone-action@${"1".repeat(40)} # v1.2.3\n`],
      [new RegExp(`${esc(API)}/repos/mgillr/truedone-sandbox/commits/(h1|sha-branch)/check-runs`), { check_runs: [{ id: 5 }] }],
      [new RegExp(`${esc(API)}/repos/mgillr/truedone-sandbox/labels`), []],
      [new RegExp(`${esc(API)}/repos/mgillr/truedone-sandbox/issues/41/labels`), []],
    ];
    for (const [pattern, body] of routes) {
      if (pattern.test(u)) return { ok: true, status: 200, json: async () => body, text: async () => String(body), arrayBuffer: async () => body };
    }
    return { ok: true, status: 200, json: async () => ({}), text: async () => "", arrayBuffer: async () => new ArrayBuffer(0) };
  };
  t.after(() => { globalThis.fetch = orig; });

  const m = fakeMessage({ event: "workflow_run", delivery: "d-2", payload: PAYLOAD });
  await worker.queue({ messages: [m] }, { APP_ID: "12345", PRIVATE_KEY: await generatedPkcs1Pem(), KV: memoryKV(), VERSION: "v" });
  assert.equal(m.acked, 1, `the delivery is handled, retried ${m.retried}`);
  const patch = calls.find((c) => c.method === "PATCH" && /\/check-runs\/5$/.test(c.url));
  assert.ok(patch, `the existing check run is updated in place; calls: ${calls.map((c) => `${c.method} ${c.url}`).join(" | ")}`);
  const label = calls.find((c) => c.method === "POST" && /\/repos\/mgillr\/truedone-sandbox\/issues\/41\/labels$/.test(c.url));
  assert.ok(label, "the label is written to the payload's pull request");
});
