// APP-22: the trial is over — every delivery writes the label by the one REST
// route, as before APP-21. These cases are the trial's tests rewritten to the
// one route, with no fewer assertions: every delivery id fires the REST POST;
// a /graphql call is never made; an issue PATCH is never made; the stale
// truedone label is deleted and the wanted one posted; the phase line carries
// label_write_ms and no label_method; and a switch-off GraphQL-routed delivery
// reaches no /graphql call while labelWrites counts a GraphQL write when one
// happens.
import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { makeApp } from "../src/index.mjs";
import { labelWrites, flagsDB } from "./lib/github.mjs";

const SECRET = "method-secret";

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

async function runDelivery(t, { deliveryId, issueLabels }) {
  const seen = { routes: [], deletes: [], patchBody: null, graphqlCalls: 0, lines: [] };
  const kv = memoryKV();
  const payload = {
    action: "synchronize",
    installation: { id: 13 },
    repository: { id: 18, owner: { login: "o" }, name: "r" },
    pull_request: { number: 9, title: "t", body: "", user: { login: "u" }, head: { ref: "b", sha: "s9" }, base: { ref: "main", sha: "b9" } },
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
    if (u.includes("/app/installations/") && u.includes("/access_tokens")) return json({ token: "tok-13", expires_at: new Date(Date.now() + 3600_000).toISOString() });
    if (u.includes("raw.githubusercontent.com") && u.includes("truedone.yml")) return new Response("comments: on\n", { status: 200 });
    if (u.includes("raw.githubusercontent.com") && u.includes("/s9/")) return new Response("const a = 2;\n", { status: 200 });
    if (u.includes("raw.githubusercontent.com")) return new Response("const a = 1;\n", { status: 200 });
    if (u.includes("/pulls/9/files")) return json([{ filename: "test/a.test.js", status: "modified", patch: "@@ -1,1 +1,1 @@" }]);
    if (u.includes("/graphql") && method === "POST") { seen.graphqlCalls += 1; return json({ data: {} }); }
    if (u.includes("/commits/s9/check-runs") && method !== "POST") return json({ check_runs: [] });
    if (u.includes("/check-runs") && method === "POST") return json({ id: 1 });
    if (u.includes("/repos/o/r/issues/9/labels") && method === "POST") { seen.routes.push("rest-post"); return json([{ name: "truedone:unrun" }]); }
    if (u.includes("/repos/o/r/issues/9") && method === "PATCH") { seen.patchBody = JSON.parse(init?.body ?? "{}"); seen.routes.push("rest-patch"); return json({}); }
    if (u.includes("/repos/o/r/issues/9/labels/truedone%3Arefuted") && method === "DELETE") { seen.deletes.push("truedone:refuted"); return json([]); }
    if (u.includes("/repos/o/r/issues/9/labels")) return json(issueLabels ?? []);
    if (u.includes("/repos/o/r/labels")) return json([{ name: "truedone:refuted", node_id: "R_node" }, { name: "bug", node_id: "B_node" }, { name: "truedone:unrun", node_id: "U_node" }]);
    if (u.includes("/repos/truedone/action/tags")) return json([]);
    return json({});
  };
  stub.calls = calls;
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
  return { seen, waited, fetch: stub, calls };
}

const timingLine = (seen) => seen.lines.map((l) => { try { return JSON.parse(l); } catch { return null; } }).find((r) => r && r.stage === "static");

test("every delivery id fires the REST POST, and never GraphQL or PATCH", async (t) => {
  for (const id of ["d-method-1", "d-method-2", "d-method-3", "d-single-1"]) {
    const { seen, waited, calls } = await runDelivery(t, { deliveryId: id, issueLabels: [{ name: "truedone:refuted" }, { name: "bug" }] });
    await waited;
    const line = timingLine(seen);
    assert.ok(line, `${id}: no phase line`);
    assert.equal(line.delivery, id, `${id}: the phase line names another delivery`);
    assert.equal(typeof line.total_ms, "number", `${id}: total_ms is not a number`);
    assert.equal(calls.filter((c) => c.method === "POST" && c.url.includes("/check-runs")).length, 1, `${id}: the check run was not written once`);
    const labelPost = calls.find((c) => c.method === "POST" && c.url.includes("/issues/9/labels"));
    assert.deepEqual(JSON.parse(labelPost.body).labels, ["truedone:unrun"], `${id}: the label POST body is not the wanted label`);
    assert.ok(calls.some((c) => c.method === "DELETE" && c.url.endsWith("/issues/9/labels/truedone%3Arefuted")), `${id}: the delete URL is not the stale label's`);
    assert.ok(seen.lines.every((l) => !l.includes("tok-13")), `${id}: the token leaked into a log line`);
    assert.ok(seen.routes.includes("rest-post"), `${id}: no REST POST; routes ${seen.routes}`);
    assert.equal(seen.graphqlCalls, 0, `${id}: a /graphql call went out`);
    assert.equal(seen.routes.includes("rest-patch"), false, `${id}: an issue PATCH went out`);
    assert.deepEqual(seen.deletes, ["truedone:refuted"], `${id}: the stale truedone label was not deleted`);
  }
});

test("the phase line carries label_write_ms and no label_method", async (t) => {
  const { seen, waited } = await runDelivery(t, { deliveryId: "d-method-3", issueLabels: [{ name: "truedone:refuted" }] });
  await waited;
  const line = timingLine(seen);
  assert.ok(line, "no phase line");
  assert.equal(line.delivery, "d-method-3", "the phase line names another delivery");
  assert.equal(typeof line.label_write_ms, "number", "label_write_ms is not a number");
  assert.deepEqual(Object.keys(line).sort(), ["check_ms", "delivery", "label_ms", "label_write_ms", "phase1_ms", "phase2_ms", "stage", "total_ms"]);
});

test("a switch-off GraphQL-routed delivery reaches no /graphql call, and labelWrites sees a GraphQL write when one happens", async (t) => {
  const off = { WEBHOOK_SECRET: SECRET };
  const kvOff = memoryKV();
  // the switch is the D1 row posting_enabled (APP-19)
  const flagsOff = flagsDB({ posting_enabled: "off", "posting_enabled:13": "on" });
  const seenOff = { graphqlCalls: 0 };
  const body = new TextEncoder().encode(JSON.stringify({
    action: "opened", installation: { id: 13 },
    repository: { id: 18, owner: { login: "o" }, name: "r" },
    pull_request: { number: 9, title: "t", body: "", user: { login: "u" }, head: { ref: "b", sha: "s9" }, base: { ref: "main", sha: "b9" } },
  }));
  const orig = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes("/graphql")) { seenOff.graphqlCalls += 1; return new Response("{}", { status: 200 }); }
    if (String(url).includes("raw.githubusercontent.com") && String(url).includes("truedone.yml")) return new Response("comments: on\n", { status: 200 });
    return new Response("{}", { status: 200 });
  };
  try {
    const app = makeApp({ ...off, KV: kvOff, FLAGS: flagsOff, APP_ID: "1", PRIVATE_KEY: await generatedPkcs1Pem(), VERSION: "test" });
    let waited;
    const ctx = { waitUntil: (p) => { waited = p; } };
    const request = new Request("https://worker.example/api/github/webhook", {
      method: "POST",
      headers: { "x-hub-signature-256": sign(body), "x-github-delivery": "d-method-1", "x-github-event": "pull_request", "content-type": "application/json" },
      body,
    });
    const response = await app(request, ctx);
    assert.equal(response.status, 200);
    assert.deepEqual(JSON.parse(await response.clone().text()), { analysing: "pull_request" }, "the switch-off delivery was not taken direct");
    await waited;
    assert.equal(seenOff.graphqlCalls, 0, "a switch-off delivery reached /graphql");
  } finally {
    globalThis.fetch = orig;
  }
  const { fetch: gatedFetch, waited: gatedWait } = await runDelivery(t, { deliveryId: "d-method-1" });
  await gatedWait;
  assert.equal(labelWrites(gatedFetch, 9).length, 1, "labelWrites does not see the REST POST write");
});
