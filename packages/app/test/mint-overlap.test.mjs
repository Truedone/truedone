// APP-18-AC01: the installation token is minted in parallel with the stage's config
// read, not before it. The mint is the App's own credential, not a repository read,
// so the APP-15 rule is untouched: a repository that opted out still has only its
// config read. Observed by calls in flight, not clocks: while the mint's
// access_tokens answer is held back, the config fetch must already have started.
import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { makeApp } from "../src/index.mjs";
import { flagsDB, compareAnswer } from "./lib/github.mjs";

const SECRET = "overlap-secret";

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

test("the config read starts while the mint is still in flight", async () => {
  const seen = { configStarted: false, mintReleased: false, checkWritten: false };
  let releaseMint;
  const mintGate = new Promise((resolve) => { releaseMint = () => { seen.mintReleased = true; resolve(); }; });
  const kv = memoryKV();
  const payload = {
    action: "opened",
    installation: { id: 7 },
    repository: { id: 12, owner: { login: "o" }, name: "r" },
    pull_request: { number: 3, title: "t", body: "", user: { login: "u" }, head: { ref: "b", sha: "s3" }, base: { ref: "main", sha: "b3" } },
  };
  const body = new TextEncoder().encode(JSON.stringify(payload));
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    const json = (x) => new Response(JSON.stringify(x), { status: 200, headers: { "content-type": "application/json" } });
    if (u.includes("/app/installations/") && u.includes("/access_tokens")) {
      await mintGate;
      return json({ token: "tok-7", expires_at: new Date(Date.now() + 3600_000).toISOString() });
    }
    if (u.includes("raw.githubusercontent.com") && u.includes("truedone.yml")) {
      seen.configStarted = !seen.mintReleased;
      return new Response("comments: on\n", { status: 200 });
    }
    if (u.includes("raw.githubusercontent.com")) return new Response("export const V = 1;\n", { status: 200 });
    if (u.includes("/pulls/3/files")) return json([]);
    if (u.includes("/compare/b3...s3")) return json(compareAnswer("b3", "s3"));
    if (u.includes("/check-runs") && init?.method !== "POST") return json({ check_runs: [], id: 1 });
    if (u.endsWith("/labels") && init?.method !== "POST") return json([]);
    if (u.includes("/repos/Truedone/truedone-action/tags")) return json([]);
    if (u.includes("/check-runs") && init?.method === "POST") { seen.checkWritten = true; return json({ id: 1 }); }
    return json({});
  };
  try {
    const env = {
      WEBHOOK_SECRET: SECRET,
      KV: kv,
      FLAGS: flagsDB(),
      APP_ID: "1",
      PRIVATE_KEY: await generatedPkcs1Pem(),
      VERSION: "test",
    };
    const app = makeApp(env);
    let waited;
    const ctx = { waitUntil: (p) => { waited = p; } };
    const request = new Request("https://worker.example/api/github/webhook", {
      method: "POST",
      headers: { "x-hub-signature-256": sign(body), "x-github-delivery": "d-overlap", "x-github-event": "pull_request", "content-type": "application/json" },
      body,
    });
    const response = await app(request, ctx);
    assert.equal(response.status, 200);
    // The stage runs in waitUntil; the config read must start while the mint is held.
    for (let i = 0; i < 100 && !seen.configStarted; i++) await new Promise((r) => setTimeout(r, 10));
    assert.ok(seen.configStarted, "the config read did not start while the mint was in flight");
    releaseMint();
    await waited;
    assert.ok(seen.checkWritten, "the stage never wrote its check run");
  } finally {
    globalThis.fetch = orig;
  }
});
