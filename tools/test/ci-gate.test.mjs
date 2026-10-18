// The shared gate suite: the fork and pin rules from SEC-01, the git-call and
// restore forms from SEC-03, and the four exit conditions over real gate
// output shapes.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { evaluate, forbiddenPaths, parseTaskId, readLockIntegrity, PROOFLINE_PIN, PROOFLINE_INTEGRITY } from "../ci-gate.mjs";

test("parseTaskId keeps SEC-01's title rule", () => {
  assert.equal(parseTaskId("SEC-02: the title"), "SEC-02");
  assert.equal(parseTaskId("SEC-02A: the title"), "SEC-02A");
  assert.equal(parseTaskId("sec-02: the title"), "");
  assert.equal(parseTaskId("SEC-2: the title"), "SEC-2");
  assert.equal(parseTaskId(""), "");
});

test("forbiddenPaths refuses node_modules and .proofline changes", () => {
  const banned = forbiddenPaths(["node_modules/.bin/proofline", ".proofline/reports/x.md", "tools/ci-gate.mjs"]);
  assert.deepEqual(banned, ["node_modules/.bin/proofline", ".proofline/reports/x.md"]);
  assert.deepEqual(forbiddenPaths(["tools/ci-gate.mjs"]), []);
});

test("readLockIntegrity reads the hidden .packages form", () => {
  const lock = { ".packages": { "node_modules/@optitransfer/proofline": { integrity: "sha512-CCC" } } };
  assert.equal(readLockIntegrity(lock), "sha512-CCC");
});

test("readLockIntegrity finds the scoped entry whatever prefixes the key", () => {
  const lock = { packages: { "node_modules/@optitransfer/proofline": { integrity: "sha512-DDD" } } };
  assert.equal(readLockIntegrity(lock), "sha512-DDD");
  assert.equal(readLockIntegrity({ ".packages": { "node_modules/@optitransfer/proofline": { integrity: "sha512-EEE" } } }), "sha512-EEE");
  assert.equal(readLockIntegrity({ packages: { "": { integrity: "sha512-nope" } } }), undefined);
});

test("readLockIntegrity reads the regular packages form", () => {
  const lock = { lockfileVersion: 3, packages: { "node_modules/@optitransfer/proofline": { integrity: "sha512-AAA" } } };
  assert.equal(readLockIntegrity(lock), "sha512-AAA");
});

test("readLockIntegrity reads the v1 dependencies form", () => {
  const lock = { lockfileVersion: 1, dependencies: { "node_modules/@optitransfer/proofline": { integrity: "sha512-BBB" } } };
  assert.equal(readLockIntegrity(lock), "sha512-BBB");
});

test("readLockIntegrity returns undefined for an unknown shape", () => {
  assert.equal(readLockIntegrity({}), undefined);
});

test("the pin integrity constant is the published sha512", () => {
  assert.match(PROOFLINE_INTEGRITY, /^sha512-[A-Za-z0-9+/=]+$/);
  assert.equal(PROOFLINE_INTEGRITY, "sha512-BLDEuPH6XGANre/R4PWj98Gn8hZLhDjsyWL5O5En630HRPcz2IhKWMwC2rPzfvtA/USE6YxsfpeMvC83/DG4Qg==");
});

test("the workflow runs on every pull request and fails on a fork", () => {
  const yml = fs.readFileSync(new URL("../../.github/workflows/ci.yml", import.meta.url), "utf8");
  assert.match(yml, /if: github\.event\.pull_request\.head\.repo\.full_name != github\.repository/, "the fork step runs only for a different head repository");
  assert.doesNotMatch(yml, /head\.repo\.full_name[^\n]*==[^\n]*github\.repository/, "no equality gate on the head repository");
  assert.match(yml, /fork pull requests are gated by the lead runner/, "the fork message is named");
});

test("the gate never uses --ci and pins an exact proofline version", () => {
  const src = fs.readFileSync(new URL("../ci-gate.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(src, /--ci\b/);
  assert.match(src, new RegExp(PROOFLINE_PIN.replace(/[.@]/g, "\\$&")));
});

test("no git call passes merge-base as a revision", () => {
  const src = fs.readFileSync(new URL("../ci-gate.mjs", import.meta.url), "utf8");
  for (const m of src.matchAll(/sh\(\[([^\]]*)\]\)/g)) {
    const args = m[1].split(",").map((s) => s.trim().replace(/^['"]|['"]$/g, ""));
    if (args[0] === "diff") assert.ok(!args.slice(1).includes("merge-base"), m[0]);
  }
});

test("the gate restores the contract byte-exact and deletes nothing", () => {
  const src = fs.readFileSync(new URL("../ci-gate.mjs", import.meta.url), "utf8");
  assert.match(src, /checkout', mainSha, '--', \.\.\.CONTRACT_PATHS/);
  assert.doesNotMatch(src, /rmSync|unlink/);
  assert.doesNotMatch(src, /stripEnvBound/);
  assert.match(src, /cat-file', '-e', `\$\{mainSha\}:guard\/owner\.pub`/);
});

test("a decision of FAIL with a mixed result set exits ok when only env-bound fail", () => {
  const gate = {
    decision: "FAIL",
    results: [
      { id: "SEC-03-AC01", status: "pass", type: "command", detail: "ok" },
      { id: "SEC-03-AC05", status: "fail", type: "command", detail: "no gh login in CI" },
    ],
    forbidden: [],
    blocked: [],
  };
  const v = evaluate(gate, ["SEC-03-AC05"]);
  assert.equal(v.ok, true);
  assert.deepEqual(v.reasons, []);
  assert.ok(v.envBoundText.includes("pass SEC-03-AC01"));
  assert.ok(v.envBoundText.includes("fail SEC-03-AC05"));
});

test("a decision of FAIL with a non-env-bound failure exits not ok", () => {
  const gate = {
    decision: "FAIL",
    results: [
      { id: "SEC-03-AC01", status: "pass", type: "command", detail: "ok" },
      { id: "SEC-03-AC02", status: "fail", type: "command", detail: "real failure" },
    ],
    forbidden: [],
    blocked: [],
  };
  const v = evaluate(gate, ["SEC-03-AC05"]);
  assert.equal(v.ok, false);
  assert.ok(v.reasons[0].includes("SEC-03-AC02 is fail"));
});

test("a decision of BLOCKED with every blocked entry env-bound exits ok", () => {
  const gate = {
    decision: "BLOCKED",
    results: [],
    forbidden: [],
    blocked: ["SEC-02/SEC-02-AC05 criterion removed by the CI copy"],
  };
  const v = evaluate(gate, ["SEC-02-AC05"]);
  assert.equal(v.ok, true);
});

test("a decision of BLOCKED with a non-env-bound blocked entry exits not ok", () => {
  const gate = {
    decision: "BLOCKED",
    results: [],
    forbidden: [],
    blocked: ["SEC-02/SEC-02-AC01 criterion removed by the CI copy"],
  };
  const v = evaluate(gate, ["SEC-02-AC05"]);
  assert.equal(v.ok, false);
});

test("an env-bound id absent from the signed map does not excuse a failure", () => {
  const gate = { decision: "FAIL", results: [{ id: "SEC-03-AC99", status: "fail", type: "command", detail: "x" }], forbidden: [], blocked: [] };
  const v = evaluate(gate, ["SEC-03-AC05"]);
  assert.equal(v.ok, false);
  assert.ok(v.reasons[0].includes("SEC-03-AC99 is fail"));
});

test("the reasons array carries one entry per failing non-env-bound result", () => {
  const gate = {
    decision: "FAIL",
    results: [
      { id: "SEC-03-AC01", status: "fail", type: "command", detail: "one" },
      { id: "SEC-03-AC02", status: "fail", type: "command", detail: "two" },
      { id: "SEC-03-AC05", status: "fail", type: "command", detail: "env-bound" },
    ],
    forbidden: [],
    blocked: [],
  };
  const v = evaluate(gate, ["SEC-03-AC05"]);
  assert.equal(v.ok, false);
  assert.equal(v.reasons.length, 2);
  assert.ok(v.reasons[0].includes("SEC-03-AC01"));
  assert.ok(v.reasons[1].includes("SEC-03-AC02"));
});

test("an empty result set with empty forbidden and blocked exits ok", () => {
  const v = evaluate({ decision: "PASS", results: [], forbidden: [], blocked: [] }, []);
  assert.equal(v.ok, true);
  assert.deepEqual(v.reasons, []);
});

test("every result status is carried into the print text", () => {
  const gate = {
    decision: "FAIL",
    results: [
      { id: "SEC-03-AC01", status: "pass", type: "command", detail: "a" },
      { id: "SEC-03-AC05", status: "fail", type: "command", detail: "b" },
      { id: "SEC-03-AC07", status: "blocked", type: "command", detail: "c" },
    ],
    forbidden: [],
    blocked: [],
  };
  const v = evaluate(gate, ["SEC-03-AC05", "SEC-03-AC07"]);
  assert.ok(v.envBoundText.includes("pass SEC-03-AC01"));
  assert.ok(v.envBoundText.includes("fail SEC-03-AC05"));
  assert.ok(v.envBoundText.includes("blocked SEC-03-AC07"));
  assert.equal(v.ok, true, "both env-bound failures are excused");
  assert.deepEqual(v.reasons, []);
  assert.deepEqual(Object.keys(gate.results ?? {}).length, 3);
  assert.equal(gate.decision, "FAIL");
});
