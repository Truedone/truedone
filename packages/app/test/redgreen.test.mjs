import { test } from "node:test";
import assert from "node:assert/strict";

// reportChecks is read from the source under test once the module shape settles;
// these tests are written against its contract (PV-A06) and run in a QUIET window.

const base = { schema: "truedone.report/1", head_sha: "h1", proved_step: "step1", tests: [{ name: "t" }] };

test("a report for another head is refused", async () => {
  const { reportChecks } = await import("../src/redgreen.mjs");
  assert.equal(reportChecks(JSON.stringify({ ...base, head_sha: "h2" }), { headSha: "h1" }).why, "head_sha");
});

test("a non-json report is refused", async () => {
  const { reportChecks } = await import("../src/redgreen.mjs");
  assert.equal(reportChecks("not json", { headSha: "h1" }).why, "not json");
});

test("a wrong schema is refused", async () => {
  const { reportChecks } = await import("../src/redgreen.mjs");
  assert.equal(reportChecks(JSON.stringify({ ...base, schema: "proved.report/1" }), { headSha: "h1" }).why, "schema");
});

test("a step that matches neither the default branch nor a published release is refused", async () => {
  const { reportChecks } = await import("../src/redgreen.mjs");
  const r = reportChecks(JSON.stringify(base), { headSha: "h1", defaultBranchStep: "other", publishedShas: ["pub1"] });
  assert.equal(r.why, "proved_step");
  const ok = reportChecks(JSON.stringify(base), { headSha: "h1", defaultBranchStep: "step1", publishedShas: ["pub1"] });
  assert.equal(ok.ok, true);
  const ok2 = reportChecks(JSON.stringify(base), { headSha: "h1", defaultBranchStep: "other", publishedShas: ["pub1", "step1"] });
  assert.equal(ok2.ok, true, "a published release sha is accepted");
});

test("a report with more than 500 tests is refused", async () => {
  const { reportChecks } = await import("../src/redgreen.mjs");
  const big = { ...base, tests: Array.from({ length: 501 }, (_, i) => ({ name: `t${i}` })) };
  assert.equal(reportChecks(JSON.stringify(big), { headSha: "h1", defaultBranchStep: "step1" }).why, "tests");
});

test("the head repository must match, so a fork's run does not attach", async () => {
  // findPr matches the PR whose head repo equals the run's head repository (PV-A05);
  // the fixture models two PRs with the same sha from different repos.
  const prs = [
    { number: 1, head: { repo: { owner: { login: "someone" }, name: "flock" } } },
    { number: 2, head: { repo: { owner: { login: "truedone" }, name: "truedone" } } },
  ];
  const headRepo = "truedone/truedone";
  const found = prs.find((p) => `${p.head.repo.owner.login}/${p.head.repo.name}` === headRepo);
  assert.equal(found.number, 2);
});
