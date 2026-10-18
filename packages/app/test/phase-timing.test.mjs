// APP-18-AC02: an analysed delivery logs exactly one line
// {stage:"static", delivery, phase1_ms, phase2_ms, phase3_ms, total_ms} — the
// switch, the reads and the writes — numbers only, no token and no payload, on
// console.log so the deployed Worker's tail carries it.
import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { makeApp } from "../src/index.mjs";

const SECRET = "phase-secret";

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

test("one analysed delivery logs exactly one phase-timing line", async () => {
  const lines = [];
  const origLog = console.log;
  console.log = (...args) => { lines.push(args.map(String).join(" ")); };
  const kv = memoryKV();
  const payload = {
    action: "opened",
    installation: { id: 9 },
    repository: { id: 14, owner: { login: "o" }, name: "r" },
    pull_request: { number: 5, title: "t", body: "", user: { login: "u" }, head: { ref: "b", sha: "s5" }, base: { ref: "main", sha: "b5" } },
  };
  const body = new TextEncoder().encode(JSON.stringify(payload));
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    const json = (x) => new Response(JSON.stringify(x), { status: 200, headers: { "content-type": "application/json" } });
    if (u.includes("/app/installations/") && u.includes("/access_tokens")) return json({ token: "tok-9", expires_at: new Date(Date.now() + 3600_000).toISOString() });
    if (u.includes("raw.githubusercontent.com") && u.includes("truedone.yml")) return new Response("comments: on\n", { status: 200 });
    if (u.includes("raw.githubusercontent.com")) return new Response("export const V = 1;\n", { status: 200 });
    if (u.includes("/pulls/5/files")) return json([]);
    if (u.includes("/check-runs") && init?.method !== "POST") return json({ check_runs: [], id: 1 });
    if (u.includes("/check-runs")) return json({ id: 1 });
    if (u.endsWith("/labels") && init?.method !== "POST") return json([]);
    if (u.includes("/repos/o/r/labels")) return json([]);
    if (u.includes("/issues/5/labels") && init?.method === "POST") return json({ id: 2 });
    if (u.includes("/repos/truedone/action/tags")) return json([]);
    return json({});
  };
  try {
    const env = { WEBHOOK_SECRET: SECRET, KV: kv, APP_ID: "1", PRIVATE_KEY: await generatedPkcs1Pem(), VERSION: "test" };
    const app = makeApp(env);
    let waited;
    const ctx = { waitUntil: (p) => { waited = p; } };
    const request = new Request("https://worker.example/api/github/webhook", {
      method: "POST",
      headers: { "x-hub-signature-256": sign(body), "x-github-delivery": "d-phase", "x-github-event": "pull_request", "content-type": "application/json" },
      body,
    });
    const response = await app(request, ctx);
    assert.equal(response.status, 200);
    await waited;
    const timing = lines.filter((l) => l.includes('"stage":"static"'));
    assert.equal(timing.length, 1, `expected exactly one phase-timing line, got ${timing.length}`);
    const row = JSON.parse(timing[0]);
    assert.deepEqual(Object.keys(row).sort(), ["delivery", "phase1_ms", "phase2_ms", "phase3_ms", "stage", "total_ms"]);
    assert.equal(row.stage, "static");
    assert.equal(row.delivery, "d-phase");
    for (const k of ["phase1_ms", "phase2_ms", "phase3_ms", "total_ms"]) assert.equal(typeof row[k], "number", `${k} is not a number`);
    assert.ok(!timing[0].includes("tok-9") && !timing[0].includes("payload"), "no token or payload in the line");
  } finally {
    console.log = origLog;
    globalThis.fetch = orig;
  }
});
