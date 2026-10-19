// APP-28: GitHub Marketplace lists an app only when the publisher receives the listing's plan changes, for a free app
// too. The listing's webhook is the App's intake, /api/github/webhook, and GitHub signs those deliveries with the
// listing's own secret, MARKETPLACE_WEBHOOK_SECRET. Everything goes through the Worker's own default export, with KV, D1,
// the queue and fetch all recording, and the payloads are GitHub's own examples (octokit/webhooks, payload-examples/
// api.github.com/marketplace_purchase: purchased, changed and cancelled; pending_change and pending_change_cancelled have
// none there, and carry the fields changed does, so they are changed with its action renamed):
// - each action, signed with the listing's secret, is answered 200 and logged in one line with the action, the plan id
//   and the account's id and type, with no login or email, and nothing is queued, kept, read from D1 or fetched;
// - a bad or missing signature, one made with the App's secret, and any delivery while the listing's secret is unset,
//   are 401 with nothing logged;
// - the listing's secret never verifies an App event, and the App's events still verify with the App's secret.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import worker from "../src/index.mjs";
import { pkcs1Pem, flagsDB } from "./lib/github.mjs";

const APP_SECRET = "app-secret";
const LISTING_SECRET = "listing-secret";
const KEY = await pkcs1Pem();
const example = (name) => JSON.parse(fs.readFileSync(new URL(`fixtures/marketplace/${name}.json`, import.meta.url), "utf8"));
const changed = example("changed");
const PAYLOADS = {
  purchased: example("purchased"),
  changed,
  cancelled: example("cancelled"),
  pending_change: { ...changed, action: "pending_change" },
  pending_change_cancelled: { ...changed, action: "pending_change_cancelled" },
};

async function signed(payload, event, delivery, secret) {
  const body = new TextEncoder().encode(JSON.stringify(payload));
  const headers = { "content-type": "application/json", "x-github-delivery": delivery, "x-github-event": event };
  if (secret !== null) {
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const mac = [...new Uint8Array(await crypto.subtle.sign("HMAC", key, body))].map((b) => b.toString(16).padStart(2, "0")).join("");
    headers["x-hub-signature-256"] = `sha256=${mac}`;
  }
  return new Request("https://truedone.dev/api/github/webhook", { method: "POST", headers, body });
}

// one Worker env whose every binding records what it is asked
function world(t, { listingSecret = LISTING_SECRET, unset = false } = {}) {
  const calls = [];
  const record = (name) => async (...a) => { calls.push([name, ...a.map((x) => (typeof x === "string" ? x : typeof x))]); return null; };
  const flags = flagsDB({ posting_enabled: "on" });
  const env = {
    WEBHOOK_SECRET: APP_SECRET, APP_ID: "12345", PRIVATE_KEY: KEY, VERSION: "v", FLAGS: flags,
    KV: { get: record("kv.get"), put: record("kv.put"), delete: record("kv.delete"), list: async () => { calls.push(["kv.list"]); return { keys: [], list_complete: true }; } },
    QUEUE: { send: record("queue.send") },
  };
  if (!unset) env.MARKETPLACE_WEBHOOK_SECRET = listingSecret;
  const orig = globalThis.fetch;
  globalThis.fetch = async (url) => { calls.push(["fetch", String(url)]); return new Response("no", { status: 599 }); };
  t.after(() => { globalThis.fetch = orig; });
  const lines = [];
  t.mock.method(console, "log", (...a) => { lines.push(a.map(String).join(" ")); });
  t.mock.method(console, "error", (...a) => { lines.push(a.map(String).join(" ")); });
  const waited = [];
  const ctx = { waitUntil(p) { waited.push(p); } };
  return { env, calls, lines, ctx, waited, statements: flags.statements };
}

// the logins and emails a payload carries, none of which may be logged
const personal = (p) => [p.sender?.login, p.sender?.email, p.marketplace_purchase?.account?.login, p.marketplace_purchase?.account?.organization_billing_email].filter(Boolean);

for (const [action, payload] of Object.entries(PAYLOADS)) {
  test(`a signed marketplace_purchase ${action} is answered 200 and logged in one line, and nothing else happens`, async (t) => {
    assert.equal(payload.action, action);
    const w = world(t);
    const res = await worker.fetch(await signed(payload, "marketplace_purchase", `d-${action}`, LISTING_SECRET), w.env, w.ctx);
    await Promise.all(w.waited);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { marketplace: action });
    const p = payload.marketplace_purchase;
    assert.deepEqual(w.lines.map((l) => JSON.parse(l)), [{ stage: "marketplace", delivery: `d-${action}`, action, plan: p.plan.id, account: p.account.id, account_type: p.account.type }]);
    assert.ok(personal(payload).length >= 3, "the example carries the logins and emails this checks");
    for (const s of personal(payload)) assert.ok(!w.lines.join("\n").includes(s), `the log line carries ${s}`);
    assert.deepEqual(w.calls, [], "no KV call, queue send or fetch");
    assert.deepEqual(w.statements, [], "no D1 statement");
  });
}

for (const [name, secret, opts] of [
  ["signed with a wrong secret", "not-the-listing-secret", {}],
  ["signed with the App's secret", APP_SECRET, {}],
  ["with no signature", null, {}],
  // With no guard, an unset or empty secret reaches Web Crypto as a zero-length key, which throws ("Zero-length key is
  // not supported", node 22.11), so the delivery failed rather than being refused. Web Crypto refuses a zero-length key
  // for signing too, so these sign with any other key.
  ["while MARKETPLACE_WEBHOOK_SECRET is unset", "any-key", { unset: true }],
  ["while MARKETPLACE_WEBHOOK_SECRET is empty", "any-key", { listingSecret: "" }],
]) {
  test(`a marketplace_purchase ${name} is 401, with nothing logged and nothing else done`, async (t) => {
    const w = world(t, opts);
    const res = await worker.fetch(await signed(PAYLOADS.purchased, "marketplace_purchase", "d-bad", secret), w.env, w.ctx);
    await Promise.all(w.waited);
    assert.equal(res.status, 401);
    assert.deepEqual(w.lines, []);
    assert.deepEqual(w.calls, []);
    assert.deepEqual(w.statements, []);
  });
}

test("the listing's secret never verifies an App event, and an App event still verifies with the App's secret", async (t) => {
  const w = world(t);
  const closed = { action: "closed", number: 6, pull_request: { number: 6 }, repository: { id: 7, name: "r", owner: { login: "o" } }, installation: { id: 3 } };
  const forged = await worker.fetch(await signed(closed, "pull_request", "d-forged", LISTING_SECRET), w.env, w.ctx);
  assert.equal(forged.status, 401);
  const real = await worker.fetch(await signed(closed, "pull_request", "d-real", APP_SECRET), w.env, w.ctx);
  assert.equal(real.status, 200);
  assert.deepEqual(await real.json(), { dropped: "pull_request.closed" });
  assert.deepEqual(w.lines, []);
});
