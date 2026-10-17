import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { parseTaskId, touchesProofline, stripEnvBound, makeGate, PROOFLINE_PIN } from "../ci-gate.mjs";

const fixture = JSON.parse(fs.readFileSync(new URL("./fixtures/ci/contract.json", import.meta.url), "utf8"));

test("the task id comes from the PR title prefix", () => {
  assert.equal(parseTaskId("CORE-01: classify files"), "CORE-01");
  assert.throws(() => parseTaskId("fix things"), /task id/);
  assert.throws(() => parseTaskId(""), /task id/);
});

test("a PR touching .proofline/ is detected", () => {
  assert.equal(touchesProofline([".proofline/reports/x.md"]), true);
  assert.equal(touchesProofline(["src/a.mjs", "docs/b.md"]), false);
});

test("stripEnvBound removes exactly the task's env-bound criteria and names them", () => {
  const { contract, removed } = stripEnvBound(fixture, "SEC-01");
  const sec = contract.tasks.find((t) => t.id === "SEC-01");
  assert.deepEqual(sec.criteria.map((c) => c.id), ["SEC-01-AC01"]);
  assert.deepEqual(removed, ["SEC-01-AC09"]);
  const app = contract.tasks.find((t) => t.id === "APP-02");
  assert.equal(app.criteria.length, 2, "other tasks keep their criteria");
});

test("stripEnvBound names a listed id even when the task lacks it", () => {
  const { removed } = stripEnvBound(fixture, "APP-02");
  assert.deepEqual(removed, ["APP-02-AC03"]);
});

function fixtureDeps(t, { sigOk = true, gateCode = 0, prContract = null } = {}) {
  const order = [];
  const files = {};
  return {
    order,
    deps: {
      git: (...a) => (a[0] === "merge-base" ? "base123" : ""),
      run: (cmd) => {
        order.push(cmd);
        if (cmd.includes("verify-sig")) return sigOk ? { code: 0 } : { code: 1 };
        return { code: gateCode };
      },
      readMain: (p) => (p === "guard/owner.pub" ? "owner-key-line\n" : p === "proofline.json" ? JSON.stringify(fixture) : "sig\n"),
      write: (p, c) => { order.push(`write:${p}`); files[p] = c; },
      remove: (p) => order.push(`remove:${p}`),
      log: (m) => order.push(`log:${m}`),
    },
    files,
  };
}

test("the gate restores main's contract, verifies, strips env-bound, then gates", async (t) => {
  const { deps, order, files } = fixtureDeps(t);
  const code = await makeGate(deps)({ title: "SEC-01: the CI gate", changedFiles: ["tools/ci-gate.mjs"] });
  assert.equal(code, 0);
  assert.match(files["proofline.json"], /SEC-01-AC01/);
  assert.doesNotMatch(files["proofline.json"], /SEC-01-AC09/, "the env-bound criterion is out of the CI copy");
  assert.ok(order.findIndex((o) => o.includes("verify-sig")) < order.indexOf("remove:guard/owner.pub"), "the owner key leaves only after the signature check");
  assert.ok(order.some((o) => o.startsWith("log:env-bound") && o.includes("SEC-01-AC09")), "the skipped criteria are printed");
  assert.ok(order.some((o) => o.includes("gate SEC-01 --skip-pushed --fresh")), "the named task is gated, never --ci");
  assert.ok(order.some((o) => o.includes('--base "base123"')), "the gate runs against the merge-base");
});

test("the base contract is used, not the PR's", async (t) => {
  const { deps, files } = fixtureDeps(t);
  await makeGate(deps)({ title: "SEC-01: the CI gate", changedFiles: [] });
  const written = JSON.parse(files["proofline.json"]);
  assert.equal(written.ci.env_bound["SEC-01"], undefined, "the env-bound entry leaves the copy entirely");
  const sec = written.tasks.find((x) => x.id === "SEC-01");
  assert.deepEqual(sec.criteria.map((c) => c.id), ["SEC-01-AC01"], "the copy descends from main's contract");
  assert.match(files["proofline.json.sig"], /sig/);
});

test("a failing criterion fails the gate", async (t) => {
  const { deps } = fixtureDeps(t, { gateCode: 1 });
  const code = await makeGate(deps)({ title: "SEC-01: the CI gate", changedFiles: [] });
  assert.equal(code, 1);
});

test("a PR that touches .proofline/ is refused before anything runs", async (t) => {
  const { deps, order } = fixtureDeps(t);
  await assert.rejects(
    makeGate(deps)({ title: "SEC-01: the CI gate", changedFiles: [".proofline/reports/r.md"] }),
    /refused/,
  );
  assert.equal(order.length, 0, "nothing ran");
});

test("a failed signature check stops the gate before the owner key is removed", async (t) => {
  const { deps, order } = fixtureDeps(t, { sigOk: false });
  await assert.rejects(makeGate(deps)({ title: "SEC-01: the CI gate", changedFiles: [] }), /verify-sig|signature/i);
  assert.ok(!order.includes("remove:guard/owner.pub"), "owner.pub survives a failed signature check");
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
  assert.match(PROOFLINE_PIN, /@optitransfer\/proofline@\d+\.\d+\.\d+/);
});
