// APP-11-AC01: the Worker's own default export, with only fetch, KV and the
// message faked, posts one check run and one truedone label for a recorded
// pull_request delivery. Production never set env.core, so every delivery
// died at the static stage (the 10:04Z tail line); the entry imports the core
// engine and hands it over. The mint runs for real on a generated PKCS#1 key,
// the format GitHub issues (APP-09).
import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.mjs";
import { flagsDB } from "./lib/github.mjs";

const API = "https://api.github.com";
const PR41 = { number: 41, title: "t", body: "", user: { login: "someone" }, head: { ref: "branch", sha: "sha-41" }, base: { ref: "main", sha: "base-41" } };
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

test("the entry's queue handler posts one check run and one label for a recorded pull_request", async (t) => {
  const calls = [];
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    calls.push({ url: u, method: init.method || "GET", body: init.body });
    const routes = [
      [new RegExp(`${esc(API)}/app/installations/3/access_tokens`), { token: "tok-1" }],
      [/raw\.githubusercontent\.com\/mgillr\/truedone-sandbox\/base-41\//, "const a = 1;\n"],
      [/raw\.githubusercontent\.com\/mgillr\/truedone-sandbox\/sha-41\//, "const a = 2;\n"],
      [new RegExp(`${esc(API)}/repos/truedone/action/tags`), []],
      // APP-25: a queued run reads the pull request from GitHub
      [new RegExp(`${esc(API)}/repos/mgillr/truedone-sandbox/pulls/41$`), PR41],
      [new RegExp(`${esc(API)}/repos/mgillr/truedone-sandbox/pulls/41/files`), [{ filename: "test/a.test.js", status: "modified", patch: "@@ -1,3 +1,3 @@" }]],
      [new RegExp(`${esc(API)}/repos/mgillr/truedone-sandbox/commits/sha-41/check-runs`), { check_runs: [] }],
      [new RegExp(`${esc(API)}/repos/mgillr/truedone-sandbox/labels`), []],
      [new RegExp(`${esc(API)}/repos/mgillr/truedone-sandbox/issues/41/labels`), []],
    ];
    for (const [pattern, body] of routes) {
      if (pattern.test(u)) return { ok: true, status: 200, json: async () => body, text: async () => String(body), arrayBuffer: async () => body };
    }
    return { ok: true, status: 200, json: async () => ({}), text: async () => "", arrayBuffer: async () => new ArrayBuffer(0) };
  };
  t.after(() => { globalThis.fetch = orig; });

  const pem = await generatedPkcs1Pem();
  const m = fakeMessage({
    event: "pull_request",
    delivery: "d-fix-1",
    payload: {
      action: "opened",
      number: 41,
      repository: { id: 9001, name: "truedone-sandbox", owner: { login: "mgillr" } },
      pull_request: PR41,
      installation: { id: 3 },
    },
  });
  await worker.queue({ messages: [m] }, { APP_ID: "12345", PRIVATE_KEY: pem, KV: memoryKV(), FLAGS: flagsDB(), VERSION: "v" });
  assert.equal(m.acked, 1, `the delivery is handled, retried ${m.retried}`);
  const check = calls.find((c) => c.method === "POST" && /\/repos\/mgillr\/truedone-sandbox\/check-runs$/.test(c.url));
  assert.ok(check, `one check run is posted; calls: ${calls.map((c) => `${c.method} ${c.url}`).join(" | ")}`);
  assert.equal(JSON.parse(check.body).head_sha, "sha-41", "the check run carries the payload's head sha");
  const label = calls.find((c) => c.method === "POST" && /\/repos\/mgillr\/truedone-sandbox\/issues\/41\/labels$/.test(c.url));
  assert.ok(label, `one truedone label is written to the payload's pull request; calls: ${calls.map((c) => `${c.method} ${c.url}`).join(" | ")}`);
});
