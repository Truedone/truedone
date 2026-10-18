// The Worker entry routes the two paths the app serves and refuses the rest (APP-01, DEP-01).
import { test } from "node:test";
import assert from "node:assert/strict";
import worker, { makeApp } from "../src/index.mjs";

const env = (over = {}) => ({ WEBHOOK_SECRET: "s", KV: { get: async () => null, put: async () => {} }, QUEUE: { send: async () => {} }, ...over });

test("/health answers the version and the global posting switch, on unless it reads off", async () => {
  const res = await makeApp(env({ VERSION: "abc1234" }))(new Request("https://x/health"));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { version: "abc1234", posting_enabled: true });
});

test("without the vars, health says unversioned; the global key off reads off", async () => {
  const res = await worker.fetch(new Request("https://x/health"), env());
  assert.deepEqual(await res.json(), { version: "unversioned", posting_enabled: true });
  const off = await makeApp(env({ KV: { get: async (k) => (k === "posting_enabled" ? "off" : null), put: async () => {} } }))(new Request("https://x/health"));
  assert.deepEqual(await off.json(), { version: "unversioned", posting_enabled: false });
});

test("the webhook path reaches the intake, which refuses a request with no signature", async () => {
  const res = await makeApp(env())(new Request("https://x/api/github/webhook", { method: "POST", body: "{}" }));
  assert.equal(res.status, 401);
});

test("every other path is 404", async () => {
  for (const p of ["/", "/api/github/manifest", "/health/x", "/webhook"]) {
    const res = await makeApp(env())(new Request(`https://x${p}`));
    assert.equal(res.status, 404, p);
  }
});
