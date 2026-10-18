// SEC-03-AC01: with a fixture contract, an env-bound failure passes the gate
// while a failure of a criterion that is not env-bound fails it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { evaluate } from "../ci-gate.mjs";

const GREEN = { decision: "PASS", results: [{ id: "SEC-03-AC01", status: "pass", type: "command", detail: "ok" }], forbidden: [], blocked: [] };

test("a passing non-env-bound result with no forbidden and no blocked exits ok", () => {
  const v = evaluate(GREEN, []);
  assert.equal(v.ok, true);
  assert.deepEqual(v.reasons, []);
});

test("a failing result outside the env-bound list is a reason", () => {
  const v = evaluate({ ...GREEN, results: [{ id: "SEC-03-AC02", status: "fail", type: "command", detail: "no" }] }, ["SEC-03-AC05"]);
  assert.equal(v.ok, false);
  assert.ok(v.reasons[0].includes("SEC-03-AC02 is fail"));
});

test("a failing env-bound result is not a reason", () => {
  const v = evaluate({ ...GREEN, results: [{ id: "SEC-03-AC05", status: "fail", type: "command", detail: "no gh login" }] }, ["SEC-03-AC05"]);
  assert.equal(v.ok, true);
});

test("a blocked entry naming an env-bound id is not a reason", () => {
  const v = evaluate({ ...GREEN, blocked: ["SEC-02/SEC-02-AC05 criterion removed"] }, ["SEC-02-AC05"]);
  assert.equal(v.ok, true);
});

test("a blocked entry naming a non-env-bound id is a reason", () => {
  const v = evaluate({ ...GREEN, blocked: ["SEC-02/SEC-02-AC01 criterion removed"] }, ["SEC-02-AC05"]);
  assert.equal(v.ok, false);
  assert.ok(v.reasons[0].includes("blocked names more than env-bound"));
});

test("a blocked line naming a bare env-bound id is not a reason (grok 3131)", () => {
  const v = evaluate({ ...GREEN, blocked: ["SEC-02-AC05: could not run: command not found: gh"] }, ["SEC-02-AC05"]);
  assert.equal(v.ok, true);
});

test("a blocked line naming two ids fails when any named id is not env-bound", () => {
  const v = evaluate({ ...GREEN, blocked: ["SEC-02/SEC-02-AC05 with SEC-02-AC01 also named"] }, ["SEC-02-AC05"]);
  assert.equal(v.ok, false);
});

test("a blocked entry naming no criterion at all is a reason", () => {
  const v = evaluate({ ...GREEN, blocked: ["task SEC-99 removed from contract"] }, ["SEC-02-AC05"]);
  assert.equal(v.ok, false);
});

test("a nonempty forbidden set is a reason", () => {
  const v = evaluate({ ...GREEN, forbidden: [{ rule: "no-skips", file: "a.test.mjs" }] }, []);
  assert.equal(v.ok, false);
  assert.ok(v.reasons[0].includes("forbidden is not empty"));
});

test("evaluate returns the env-bound ids and the statuses for printing", () => {
  const v = evaluate({ ...GREEN, results: [{ id: "SEC-03-AC05", status: "fail", type: "command", detail: "x" }] }, ["SEC-03-AC05"]);
  assert.ok(v.envBoundText.includes("SEC-03-AC05"));
  assert.ok(v.envBoundText.includes("fail SEC-03-AC05"));
});

test("the real origin/main contract shape carries usable env-bound lists", () => {
  const raw = execFileSync("git", ["show", "origin/main:proofline.json"], { encoding: "utf8" });
  const contract = JSON.parse(raw);
  const map = contract.ci?.env_bound ?? {};
  assert.equal(typeof map, "object");
  const keys = Object.keys(map);
  assert.ok(keys.length > 0, "the signed contract maps env-bound ids per task");
  for (const k of keys) {
    assert.ok(Array.isArray(map[k]), k);
    for (const id of map[k]) {
      const v = evaluate({ ...GREEN, results: [{ id, status: "fail", type: "command", detail: "no gh login" }] }, map[k]);
      assert.equal(v.ok, true, `${id} is env-bound for ${k}`);
    }
  }
  const v = evaluate({ ...GREEN, results: [{ id: "NOT-ENV-BOUND-AC99", status: "fail", type: "command", detail: "x" }] }, keys.length ? map[keys[0]] : []);
  assert.equal(v.ok, false, "an id outside every signed list counts");
});
