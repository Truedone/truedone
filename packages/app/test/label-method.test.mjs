// APP-21-AC01: the label write is trialled by method, chosen by the delivery
// id's hash: 1 the REST POST, 2 GraphQL addLabelsToLabelable, 3 a REST PATCH of
// the issue with the full list. The phase line carries label_write_ms and
// label_method. Observed by routes and bodies, not clocks. Fixed vectors:
// d-method-3 hashes to the REST POST, d-method-1 to GraphQL, d-method-2 to the
// PATCH.
import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { makeApp } from "../src/index.mjs";
import { labelWrites } from "./lib/github.mjs";

const SECRET = "method-secret";

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

async function runDelivery(t, { deliveryId, graphqlAnswer, issueLabels, repoLabels }) {
  const seen = { routes: [], patchBody: null, graphqlBody: null, lines: [] };
  const kv = memoryKV();
  const payload = {
    action: "opened",
    installation: { id: 13 },
    repository: { id: 18, owner: { login: "o" }, name: "r" },
    pull_request: { number: 9, node_id: "PR_node_1", title: "t", body: "", user: { login: "u" }, head: { ref: "b", sha: "s9" }, base: { ref: "main", sha: "b9" } },
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
    if (u.includes("raw.githubusercontent.com") && u.includes("/b9/")) return new Response("const a = 2;\n", { status: 200 });
    if (u.includes("raw.githubusercontent.com")) return new Response("const a = 1;\n", { status: 200 });
    if (u.includes("/pulls/9/files")) return json([{ filename: "test/a.test.js", status: "modified", patch: "@@ -1,1 +1,1 @@" }]);
    if (u.includes("/graphql") && method === "POST") {
      seen.graphqlBody = init?.body ? JSON.parse(init.body) : null;
      seen.routes.push(graphqlAnswer ? "graphql-errors" : "graphql");
      if (graphqlAnswer) return json({ errors: [{ message: "nope" }] });
      return json({ data: { addLabelsToLabelable: { labelable: { number: 9 } } } });
    }
    if (u.includes("/commits/s9/check-runs") && method !== "POST") return json({ check_runs: [] });
    if (u.includes("/check-runs") && method === "POST") return json({ id: 1 });
    if (u.includes("/repos/o/r/issues/9/labels") && method === "POST") { seen.routes.push("rest-post"); return json([{ name: "truedone:unrun" }]); }
    if (u.includes("/repos/o/r/issues/9") && method === "PATCH") { seen.patchBody = JSON.parse(init?.body ?? "{}"); seen.routes.push("rest-patch"); return json({}); }
    if (u.includes("/repos/o/r/issues/9/labels") && method === "DELETE") { seen.routes.push("rest-delete"); return json([]); }
    if (u.includes("/repos/o/r/issues/9/labels")) return json(issueLabels ?? []);
    if (u.includes("/repos/o/r/labels")) return json(repoLabels ?? [{ name: "truedone:unrun", node_id: "LABEL_node_1", color: "000000", description: "" }]);
    if (u.includes("/repos/truedone/action/tags")) return json([]);
    return json({});
  };
  stub.calls = calls;
  globalThis.fetch = stub;
  t.after(() => { console.log = origLog; globalThis.fetch = orig; });
  const env = { WEBHOOK_SECRET: SECRET, KV: kv, APP_ID: "1", PRIVATE_KEY: await generatedPkcs1Pem(), VERSION: "test" };
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
  return { seen, waited, fetch: stub };
}

const timingLine = (seen) => seen.lines.map((l) => { try { return JSON.parse(l); } catch { return null; } }).find((r) => r && r.stage === "static");

test("each fixed delivery id fires its hashed method and no other", async (t) => {
  const expect = { "d-method-3": "rest-post", "d-method-1": "graphql", "d-method-2": "rest-patch" };
  for (const [id, method] of Object.entries(expect)) {
    const { seen, waited } = await runDelivery(t, { deliveryId: id });
    await waited;
    const line = timingLine(seen);
    assert.ok(line, `${id}: no phase line`);
    assert.equal(line.label_method, method, `${id}: routed to ${line.label_method}, expected ${method}`);
    assert.equal(typeof line.label_write_ms, "number", `${id}: label_write_ms is not a number`);
    const writes = seen.routes.filter((r) => ["rest-post", "graphql", "rest-patch"].includes(r));
    assert.ok(writes.every((r) => r === method), `${id}: unexpected write routes ${writes}`);
  }
});

test("a GraphQL 200 with errors throws instead of passing", async (t) => {
  const errors = [];
  const origErr = console.error;
  console.error = (...args) => { errors.push(args.map(String).join(" ")); };
  try {
    const { seen, waited } = await runDelivery(t, { deliveryId: "d-method-1", graphqlAnswer: true });
    await waited;
    assert.ok(seen.routes.includes("graphql-errors"), "the errors answer was not used");
    assert.equal(timingLine(seen), undefined, "the stage completed despite the GraphQL error");
    assert.ok(errors.some((e) => e.includes("graphql")), `the throw was not logged: ${errors}`);
  } finally {
    console.error = origErr;
  }
});

test("the PATCH body preserves a user label", async (t) => {
  const { seen, waited } = await runDelivery(t, { deliveryId: "d-method-2", issueLabels: [{ name: "bug", node_id: "B_node" }] });
  await waited;
  assert.ok(seen.patchBody, "no PATCH was sent");
  assert.ok(seen.patchBody.labels.includes("bug"), `the user label was lost: ${seen.patchBody.labels}`);
  assert.ok(seen.patchBody.labels.includes("truedone:unrun"), `the wanted label is missing: ${seen.patchBody.labels}`);
});

test("a switch-off GraphQL delivery makes no /graphql call, and labelWrites sees a GraphQL write", async (t) => {
  // The guard: with the switch off, a GraphQL-routed delivery must not reach
  // /graphql at all, and the helper must count a GraphQL write when one happens.
  const off = { WEBHOOK_SECRET: SECRET };
  const kvOff = memoryKV();
  kvOff.put("posting_enabled", "off");
  kvOff.put("posting_enabled:13", "on");
  const seenOff = { graphqlCalls: 0 };
  const body = new TextEncoder().encode(JSON.stringify({
    action: "opened", installation: { id: 13 },
    repository: { id: 18, owner: { login: "o" }, name: "r" },
    pull_request: { number: 9, node_id: "PR_node_1", title: "t", body: "", user: { login: "u" }, head: { ref: "b", sha: "s9" }, base: { ref: "main", sha: "b9" } },
  }));
  const orig = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes("/graphql")) { seenOff.graphqlCalls += 1; return new Response("{}", { status: 200 }); }
    if (String(url).includes("raw.githubusercontent.com") && String(url).includes("truedone.yml")) return new Response("comments: on\n", { status: 200 });
    return new Response("{}", { status: 200 });
  };
  try {
    const app = makeApp({ ...off, KV: kvOff, APP_ID: "1", PRIVATE_KEY: await generatedPkcs1Pem(), VERSION: "test" });
    let waited;
    const ctx = { waitUntil: (p) => { waited = p; } };
    const request = new Request("https://worker.example/api/github/webhook", {
      method: "POST",
      headers: { "x-hub-signature-256": sign(body), "x-github-delivery": "d-method-1", "x-github-event": "pull_request", "content-type": "application/json" },
      body,
    });
    const response = await app(request, ctx);
    assert.equal(response.status, 200);
    await waited;
    assert.equal(seenOff.graphqlCalls, 0, "a switch-off delivery reached /graphql");
  } finally {
    globalThis.fetch = orig;
  }
  // And the helper sees a GraphQL write when one happens: red while labelWrites
  // counts only the REST routes.
  const { fetch: gatedFetch, waited: gatedWait } = await runDelivery(t, { deliveryId: "d-method-1" });
  await gatedWait;
  assert.equal(labelWrites(gatedFetch, 9).length, 1, "labelWrites does not see the GraphQL write");
});

test("the phase line carries label_write_ms and label_method", async (t) => {
  const { seen, waited } = await runDelivery(t, { deliveryId: "d-method-3" });
  await waited;
  const line = timingLine(seen);
  assert.ok(line, "no phase line");
  assert.equal(typeof line.label_write_ms, "number", "label_write_ms is not a number");
  assert.equal(typeof line.label_method, "string", "label_method is not a string");
});
