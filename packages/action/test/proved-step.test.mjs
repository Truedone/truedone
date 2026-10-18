// PV-A06: the report's proved_step is the action ref when it is a full sha
// and empty otherwise, so an unpinned @main step cannot be proven.
import { test } from "node:test";
import assert from "node:assert/strict";
import { provedStep } from "../src/main.mjs";

test("proved_step carries a full-sha action ref and refuses an unpinned one", () => {
  assert.equal(provedStep("0123456789abcdef0123456789abcdef01234567"), "0123456789abcdef0123456789abcdef01234567");
  assert.equal(provedStep("main"), "");
  assert.equal(provedStep("v0.1.0"), "");
  assert.equal(provedStep(""), "");
  assert.equal(provedStep(undefined), "");
});
