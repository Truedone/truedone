import { test } from "node:test";
import assert from "node:assert/strict";
import { makeHealth } from "../src/health.mjs";

test("health answers the version and the switch", async () => {
  const health = makeHealth({ version: "1.2.3", postingEnabled: true });
  const r = await health(new Request("https://app.truedone.dev/health"));
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.version, "1.2.3");
  assert.equal(body.posting_enabled, true);
});

test("health reflects a disabled switch", async () => {
  const health = makeHealth({ version: "1.2.3", postingEnabled: false });
  const r = await health(new Request("https://app.truedone.dev/health"));
  const body = await r.json();
  assert.equal(body.posting_enabled, false);
});

test("other paths answer 404", async () => {
  const health = makeHealth({ version: "1", postingEnabled: true });
  const r = await health(new Request("https://app.truedone.dev/other"));
  assert.equal(r.status, 404);
});
