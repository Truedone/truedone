import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { runGate } from "../src/main.mjs";

// ACT-03-AC02 (S2): after the step HEAD and git status --porcelain equal what
// they were before; a dirty restore reports Could not run and fails.

const git = (...a) => execFileSync("git", a, { encoding: "utf8" }).trim();

function fixtureRepo({ drifts = false }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "act03-restore-"));
  const cfg = ["-C", dir, "-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "maintenance.auto=false", "-c", "gc.auto=0"];
  git(...cfg, "init", "-b", "main");
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "fx", private: true, scripts: { test: "node --test" } }));
  fs.mkdirSync(path.join(dir, "src"));
  fs.writeFileSync(path.join(dir, "src", "thing.mjs"), "export const V = 1;\n");
  git(...cfg, "add", ".");
  git(...cfg, "commit", "-q", "-m", "base");
  const base = git(...cfg, "rev-parse", "HEAD");
  fs.writeFileSync(path.join(dir, "src", "thing.mjs"), `export const V = 2;\n${drifts ? "export const DRIFT_MARK = 1;\n" : ""}`);
  fs.mkdirSync(path.join(dir, "test"));
  fs.writeFileSync(path.join(dir, "test", "a.test.mjs"), drifts
    ? `import { test } from "node:test";\nimport assert from "node:assert/strict";\nimport fs from "node:fs";\nimport { V } from "../src/thing.mjs";\ntest("v is 2", () => {\n  if (process.env.DRIFT === "1") fs.appendFileSync(new URL("../src/thing.mjs", import.meta.url), "// drifted\\n");\n  assert.equal(V, 2);\n});\n`
    : `import { test } from "node:test";\nimport assert from "node:assert/strict";\nimport { V } from "../src/thing.mjs";\ntest("v is 2", () => {\n  assert.equal(V, 2);\n});\n`);
  git(...cfg, "add", ".");
  git(...cfg, "commit", "-q", "-m", "head");
  const head = git(...cfg, "rev-parse", "HEAD");
  const eventPath = path.join(os.tmpdir(), `act03-ev-${process.pid}-${Math.random().toString(36).slice(2)}.json`);
  fs.writeFileSync(eventPath, JSON.stringify({ pull_request: { base: { sha: base }, head: { sha: head }, merge_commit_sha: head } }));
  return { dir, cfg, base, head, eventPath };
}

const snapshot = (dir) => ({ head: git("-C", dir, "rev-parse", "HEAD"), status: git("-C", dir, "status", "--porcelain") });

test("after the step HEAD and git status are exactly what they were", async () => {
  const f = fixtureRepo({});
  const before = snapshot(f.dir);
  const r = await runGate({ root: f.dir, eventPath: f.eventPath, githubSha: f.head, env: process.env });
  assert.equal(r.code, 0);
  const after = snapshot(f.dir);
  assert.equal(after.head, before.head);
  assert.equal(after.status, before.status);
  assert.equal(after.status, "", "the fixture itself stays clean");
});

test("the step really ran red-green: the test fails twice on base and passes three times on head", async () => {
  const f = fixtureRepo({});
  const r = await runGate({ root: f.dir, eventPath: f.eventPath, githubSha: f.head, env: process.env });
  assert.equal(r.code, 0);
  const entry = r.report.tests[0];
  assert.deepEqual(entry.base, ["fail:assertion", "fail:assertion"]);
  assert.deepEqual(entry.head, ["pass", "pass", "pass"]);
});

test("a dirty restore reports Could not run and fails the step", async () => {
  const f = fixtureRepo({ drifts: true });
  const r = await runGate({ root: f.dir, eventPath: f.eventPath, githubSha: f.head, env: { ...process.env, DRIFT: "1" } });
  assert.equal(r.code, 1, "the step fails");
  assert.equal(git("-C", f.dir, "status", "--porcelain").includes("src/thing.mjs"), true, "the drift is left visible for the operator");
});

test("a run after a drifted one restores the record first and succeeds", async () => {
  const f = fixtureRepo({ drifts: true });
  await runGate({ root: f.dir, eventPath: f.eventPath, githubSha: f.head, env: { ...process.env, DRIFT: "1" } });
  git(...f.cfg, "checkout", "-q", "--", "src/thing.mjs");
  const r = await runGate({ root: f.dir, eventPath: f.eventPath, githubSha: f.head, env: process.env });
  assert.equal(r.code, 0, "the second, clean run succeeds");
  const after = snapshot(f.dir);
  assert.equal(after.status, "", "the tree is exactly as it was");
});
