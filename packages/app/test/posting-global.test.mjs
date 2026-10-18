// APP-09-AC04: one global switch, posting_enabled, read before every write beside the per-installation one, and
// /health reports it from that switch, not from an environment variable. Main read only the per-installation key and
// reported an env var. APP-19 (#107): both are rows of the D1 table flags; the global row is on only when it reads
// "on", so with no global row nothing posts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { postingAllowed } from "../src/posting.mjs";
import { makeApp } from "../src/index.mjs";
import { flagsDB } from "./lib/github.mjs";

test("the global posting_enabled row off stops every write", async () => {
  const r = await postingAllowed({ FLAGS: flagsDB({ posting_enabled: "off" }) }, { installationId: 3, configText: "" });
  assert.deepEqual(r, { allowed: false, reason: "posting_disabled" });
});

test("with the global row absent nothing posts; with it on, the installation's row decides", async () => {
  const none = await postingAllowed({ FLAGS: flagsDB({}) }, { installationId: 3, configText: "" });
  assert.deepEqual(none, { allowed: false, reason: "posting_disabled" });
  const r = await postingAllowed({ FLAGS: flagsDB({ posting_enabled: "on", "posting_enabled:3": "off" }) }, { installationId: 3, configText: "" });
  assert.deepEqual(r, { allowed: false, reason: "posting_disabled" });
  const ok = await postingAllowed({ FLAGS: flagsDB() }, { installationId: 3, configText: "" });
  assert.deepEqual(ok, { allowed: true });
});

test("the global row is read on every call: flipping it between calls is seen", async () => {
  const db = flagsDB();
  const first = await postingAllowed({ FLAGS: db }, { installationId: 3, configText: "" });
  db.store.set("posting_enabled", "off");
  const second = await postingAllowed({ FLAGS: db }, { installationId: 3, configText: "" });
  assert.equal(first.allowed, true);
  assert.equal(second.allowed, false);
});

test("/health reports posting_enabled from the global row, not an environment variable", async () => {
  const db = flagsDB();
  const app = makeApp({ VERSION: "v-1", FLAGS: db, POSTING_ENABLED: "true" });
  const on = await app(new Request("https://app.truedone.dev/health"));
  assert.equal((await on.json()).posting_enabled, true, "on when the row reads on");
  db.store.set("posting_enabled", "off");
  const off = await app(new Request("https://app.truedone.dev/health"));
  assert.equal((await off.json()).posting_enabled, false, "the env var does not override the row");
});
