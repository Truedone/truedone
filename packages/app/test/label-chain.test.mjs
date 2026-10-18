// APP-20-AC01: the label chain no longer waits for any check-run call. After the
// switch, two chains share the one analysis promise: (analyse, labelState) then
// postLabel, and (analyse, checkRunFor) then postCheck. Observed by calls in
// flight, not clocks: with the check-run lookup held open, the label POST is
// still sent. At the parent the phase-2 barrier means it never is.
import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { makeApp } from "../src/index.mjs";
import { flagsDB } from "./lib/github.mjs";

const SECRET = "chain-secret";

function memoryKV() {
  const store = new Map();
  return {
    async get(k) { return store.get(k) ?? null; },
    async put(k, v) { store.set(k, v); },
    async delete(k) { store.delete(k); },
    async list() { return { keys: [], list_complete: true, cursor: undefined }; },
  };
}

async function generatedPkcs1Pem() {
  const pair = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  );
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
  const der = pkcs8.slice(26);
  let bin = "";
  for (let i = 0; i < der.length; i += 0x8000) bin += String.fromCharCode.apply(null, der.subarray(i, i + 0x8000));
  return `-----BEGIN RSA PRIVATE KEY-----\n${btoa(bin)}\n-----END RSA PRIVATE KEY-----`;
}

function sign(body) {
  return "sha256=" + crypto.createHmac("sha256", SECRET).update(body).digest("hex");
}

test("the label POST is sent while the check-run lookup is held open", async () => {
  const seen = { labelPosted: false, checkReleased: false };
  let releaseCheck;
  const checkGate = new Promise((resolve) => { releaseCheck = () => { seen.checkReleased = true; resolve(); }; });
  const kv = memoryKV();
  const payload = {
    action: "opened",
    installation: { id: 11 },
    repository: { id: 16, owner: { login: "o" }, name: "r" },
    pull_request: { number: 7, title: "t", body: "", user: { login: "u" }, head: { ref: "b", sha: "s7" }, base: { ref: "main", sha: "b7" } },
  };
  const body = new TextEncoder().encode(JSON.stringify(payload));
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    const json = (x) => new Response(JSON.stringify(x), { status: 200, headers: { "content-type": "application/json" } });
    if (u.includes("/app/installations/") && u.includes("/access_tokens")) return json({ token: "tok-11", expires_at: new Date(Date.now() + 3600_000).toISOString() });
    if (u.includes("raw.githubusercontent.com") && u.includes("truedone.yml")) return new Response("comments: on\n", { status: 200 });
    if (u.includes("raw.githubusercontent.com") && u.includes("/b7/")) return new Response("const a = 2;\n", { status: 200 });
    if (u.includes("raw.githubusercontent.com")) return new Response("const a = 1;\n", { status: 200 });
    if (u.includes("/pulls/7/files")) return json([{ filename: "test/a.test.js", status: "modified", patch: "@@ -1,1 +1,1 @@" }]);
    if (u.includes("/commits/s7/check-runs") && init?.method !== "POST") { await checkGate; return json({ check_runs: [] }); }
    if (u.includes("/check-runs") && init?.method === "POST") return json({ id: 1 });
    if (u.endsWith("/labels") && init?.method !== "POST") return json([]);
    if (u.includes("/labels") && init?.method === "POST") { seen.labelPosted = true; return json({ id: 2 }); }
    if (u.includes("/repos/truedone/action/tags")) return json([]);
    return json({});
  };
  try {
    const env = { WEBHOOK_SECRET: SECRET, KV: kv, FLAGS: flagsDB(), APP_ID: "1", PRIVATE_KEY: await generatedPkcs1Pem(), VERSION: "test" };
    const app = makeApp(env);
    let waited;
    const ctx = { waitUntil: (p) => { waited = p; } };
    const request = new Request("https://worker.example/api/github/webhook", {
      method: "POST",
      headers: { "x-hub-signature-256": sign(body), "x-github-delivery": "d-chain", "x-github-event": "pull_request", "content-type": "application/json" },
      body,
    });
    const response = await app(request, ctx);
    assert.equal(response.status, 200);
    for (let i = 0; i < 100 && !seen.labelPosted; i++) await new Promise((r) => setTimeout(r, 10));
    assert.ok(seen.labelPosted, "the label POST waited for the check-run lookup");
    releaseCheck();
    await waited;
    assert.ok(seen.checkReleased, "the check chain never settled");
  } finally {
    globalThis.fetch = orig;
  }
});
