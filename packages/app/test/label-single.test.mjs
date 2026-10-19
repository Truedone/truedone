// APP-22-AC01: every delivery writes the label by the one REST route, as before
// APP-21. For several delivery ids — one of which hashes to GraphQL on main —
// an issue carrying truedone:unrun and the user label bug, with a verdict
// wanting truedone:review, ends with [bug, truedone:review], written by the
// REST POST, with no /graphql call and no issue PATCH.
import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { makeApp } from "../src/index.mjs";
import { flagsDB } from "./lib/github.mjs";

const SECRET = "single-secret";

function memoryKV() {
  const store = new Map();
  return {
    async get(k) { return store.has(k) ? store.get(k) : null; },
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

async function runDelivery(t, deliveryId) {
  const seen = { routes: [], deletes: [], patchBody: null, lines: [], calls: [] };
  const kv = memoryKV();
  const payload = {
    action: "synchronize",
    installation: { id: 17 },
    repository: { id: 21, owner: { login: "o" }, name: "r" },
    pull_request: { number: 11, node_id: "PR_node_11", title: "t", body: "", user: { login: "u" }, head: { ref: "b", sha: "s11" }, base: { ref: "main", sha: "b11" } },
  };
  const body = new TextEncoder().encode(JSON.stringify(payload));
  const origLog = console.log;
  console.log = (...args) => { seen.lines.push(args.map(String).join(" ")); };
  const orig = globalThis.fetch;
  const calls = [];
  const stub = async (url, init = {}) => {
    const u = String(url);
    const method = init?.method || "GET";
    calls.push({ url: u, method, headers: { ...(init.headers || {}) }, body: init.body });
    const json = (x) => new Response(JSON.stringify(x), { status: 200, headers: { "content-type": "application/json" } });
    if (u.includes("/app/installations/") && u.includes("/access_tokens")) return json({ token: "tok-17", expires_at: new Date(Date.now() + 3600_000).toISOString() });
    if (u.includes("raw.githubusercontent.com") && u.includes("truedone.yml")) return new Response("comments: on\n", { status: 200 });
    if (u.includes("raw.githubusercontent.com") && u.includes("/s11/")) return new Response("const a = 2;\n", { status: 200 });
    if (u.includes("raw.githubusercontent.com")) return new Response("const a = 1;\n", { status: 200 });
    if (u.includes("/pulls/11/files")) return json([{ filename: "test/a.test.js", status: "modified", patch: "@@ -1,1 +1,1 @@" }]);
    if (u.includes("/graphql") && method === "POST") { seen.routes.push("graphql"); return json({ data: {} }); }
    if (u.includes("/commits/s11/check-runs") && method !== "POST") return json({ check_runs: [] });
    if (u.includes("/check-runs") && method === "POST") return json({ id: 1 });
    if (u.includes("/repos/o/r/issues/11/labels") && method === "POST") { seen.routes.push("rest-post"); return json([{ name: "truedone:review" }]); }
    if (u.includes("/repos/o/r/issues/11") && method === "PATCH") { seen.patchBody = JSON.parse(init?.body ?? "{}"); seen.routes.push("rest-patch"); return json({}); }
    if (u.includes("/repos/o/r/issues/11/labels/truedone%3Arefuted") && method === "DELETE") { seen.deletes.push("truedone:refuted"); return json([]); }
    if (u.includes("/repos/o/r/issues/11/labels")) return json([{ name: "truedone:refuted" }, { name: "bug" }]);
    if (u.includes("/repos/o/r/labels")) return json([{ name: "truedone:unrun", node_id: "LABEL_11" }, { name: "bug", node_id: "B_node" }, { name: "truedone:review", node_id: "R_node" }]);
    if (u.includes("/repos/Truedone/truedone-action/tags")) return json([]);
    return json({});
  };
  stub.calls = calls;
  seen.calls = calls;
  globalThis.fetch = stub;
  t.after(() => { console.log = origLog; globalThis.fetch = orig; });
  const env = { WEBHOOK_SECRET: SECRET, KV: kv, FLAGS: flagsDB(), APP_ID: "1", PRIVATE_KEY: await generatedPkcs1Pem(), VERSION: "test" };
  const app = makeApp(env);
  let waited;
  const ctx = { waitUntil: (p) => { waited = p; } };
  const request = new Request("https://worker.example/api/github/webhook", {
    method: "POST",
    headers: { "x-hub-signature-256": sign(body), "x-github-delivery": deliveryId, "x-github-event": "pull_request", "content-type": "application/json" },
    body,
  });
  const response = await app(request, ctx);
  assert.equal(response.status, 200);
  await waited;
  return seen;
}

test("verdict changes end with one truedone label via the REST POST, for every delivery id", async (t) => {
  // d-method-1 hashes to GraphQL on the parent's dispatch; the rest hash to the
  // other two routes. All must end the same way on the one route.
  for (const id of ["d-method-1", "d-method-2", "d-method-3", "d-single-1"]) {
    const seen = await runDelivery(t, id);
    assert.ok(seen.routes.includes("rest-post"), `${id}: no REST POST; routes ${seen.routes}; lines ${JSON.stringify(seen.lines)}; checkrun ${JSON.stringify((seen.calls.find((c) => c.method === "POST" && c.url.includes("/check-runs")) || {}).body || null)}`);
    assert.ok(!seen.routes.includes("graphql"), `${id}: a /graphql call went out`);
    assert.ok(!seen.routes.includes("rest-patch"), `${id}: an issue PATCH went out`);
    assert.deepEqual(seen.deletes, ["truedone:refuted"], `${id}: the stale truedone label was not deleted`);
    const line = seen.lines.map((l) => { try { return JSON.parse(l); } catch { return null; } }).find((r) => r && r.stage === "static");
    assert.ok(line, `${id}: no phase line`);
    assert.equal(typeof line.label_write_ms, "number", `${id}: label_write_ms is not a number`);
  }
});
