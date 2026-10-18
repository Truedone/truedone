import { test } from "node:test";
import assert from "node:assert/strict";
import { makeHealth } from "../src/health.mjs";
import { flagsDB } from "./lib/github.mjs";

// The switch is the D1 row posting_enabled (APP-19): on only when it reads "on", so a missing row reads off, and a read
// that fails answers 503.
test("health answers the version and the switch, on only when the row reads on", async () => {
  const r = await makeHealth({ version: "1.2.3", flags: flagsDB() })(new Request("https://app.truedone.dev/health"));
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.version, "1.2.3");
  assert.equal(body.posting_enabled, true);
  const unseeded = await (await makeHealth({ version: "1", flags: flagsDB({}) })(new Request("https://app.truedone.dev/health"))).json();
  assert.equal(unseeded.posting_enabled, false, "a missing row reads off");
});

test("health reads the row on every request: a flip between requests is seen", async () => {
  const db = flagsDB();
  const health = makeHealth({ version: "1", flags: db });
  const on = await (await health(new Request("https://app.truedone.dev/health"))).json();
  db.store.set("posting_enabled", "off");
  const off = await (await health(new Request("https://app.truedone.dev/health"))).json();
  assert.equal(on.posting_enabled, true);
  assert.equal(off.posting_enabled, false);
});

test("a switch that cannot be read answers 503, not a guess", async () => {
  const r = await makeHealth({ version: "1", flags: flagsDB({}, { fail: true }) })(new Request("https://app.truedone.dev/health"));
  assert.equal(r.status, 503);
  assert.equal((await r.json()).posting_enabled, undefined);
});

test("other paths answer 404", async () => {
  const r = await makeHealth({ version: "1", flags: flagsDB() })(new Request("https://app.truedone.dev/other"));
  assert.equal(r.status, 404);
});
