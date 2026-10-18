import { test } from "node:test";
import assert from "node:assert/strict";
import { LABELS, VERDICT_LABEL } from "../src/labels.mjs";

test("every label is named truedone:* with a color and a description under 100 characters ending in the why link", () => {
  for (const l of Object.values(LABELS)) {
    assert.match(l.name, /^truedone:[a-z-]+$/);
    assert.match(l.color, /^[0-9a-f]{6}$/);
    assert.ok(l.description.length <= 100, `${l.name} description is ${l.description.length} characters`);
    assert.ok(l.description.endsWith("truedone.pages.dev/why"));
  }
});

test("every non-applicable verdict maps to no label and every other verdict maps to one", () => {
  const verdicts = ["tampered", "review", "could_not_run", "proven", "proven_new", "proven_weak", "no_evidence", "pending", "unrun", "not_applicable"];
  for (const v of verdicts) {
    assert.ok(v in VERDICT_LABEL, `VERDICT_LABEL knows ${v}`);
    if (v === "not_applicable") assert.equal(VERDICT_LABEL[v], null);
    else assert.ok(LABELS.some((x) => x.name === VERDICT_LABEL[v]), `${v} maps to a known label`);
  }
});

test("proven and proven_new share the yes label; the rest have their own", () => {
  assert.equal(VERDICT_LABEL.proven, "truedone:yes");
  assert.equal(VERDICT_LABEL.proven_new, "truedone:yes");
  const names = Object.values(VERDICT_LABEL).filter(Boolean);
  const distinct = new Set(names);
  assert.equal(distinct.size, names.length - 1, "exactly the yes pair shares; every other verdict names its own label");
});
