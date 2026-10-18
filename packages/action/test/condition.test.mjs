import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { runGate } from "../src/main.mjs";

// ACT-03-AC03 (D8, PV-X05): the report names the coverage condition used.

const git = (...a) => execFileSync("git", a, { encoding: "utf8" }).trim();

function fixtureRepo({ headSource, testText }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "act03-cond-"));
  const cfg = ["-C", dir, "-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "maintenance.auto=false", "-c", "gc.auto=0"];
  git(...cfg, "init", "-b", "main");
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "fx", private: true, scripts: { test: "node --test" } }));
  fs.mkdirSync(path.join(dir, "src"));
  fs.writeFileSync(path.join(dir, "src", "calc.mjs"), "export function f() { return 1; }\n");
  git(...cfg, "add", ".");
  git(...cfg, "commit", "-q", "-m", "base");
  const base = git(...cfg, "rev-parse", "HEAD");
  fs.writeFileSync(path.join(dir, "src", "calc.mjs"), headSource);
  fs.mkdirSync(path.join(dir, "test"));
  fs.writeFileSync(path.join(dir, "test", "cal.test.mjs"), testText);
  git(...cfg, "add", ".");
  git(...cfg, "commit", "-q", "-m", "head");
  const head = git(...cfg, "rev-parse", "HEAD");
  const eventPath = path.join(os.tmpdir(), `act03-ev-${process.pid}-${Math.random().toString(36).slice(2)}.json`);
  fs.writeFileSync(eventPath, JSON.stringify({ pull_request: { base: { sha: base }, head: { sha: head }, merge_commit_sha: head } }));
  return { dir, base, head, eventPath };
}

const WITH_G = "export function f() { return 1; }\nexport function g() { return 2; }\n";

test("a test that runs the changed line names lines", async () => {
  const f = fixtureRepo({
    headSource: WITH_G,
    testText: `import { test } from "node:test";\nimport assert from "node:assert/strict";\nimport * as calc from "../src/calc.mjs";\ntest("f and g", () => {\n  assert.equal(calc.f(), 1);\n  assert.equal(calc.g(), 2);\n});\n`,
  });
  const r = await runGate({ root: f.dir, eventPath: f.eventPath, githubSha: f.head, env: process.env });
  assert.equal(r.code, 0);
  assert.equal(r.report.tests[0].condition, "lines");
});

test("a test that only imports the changed module names imports", async () => {
  const f = fixtureRepo({
    headSource: WITH_G,
    testText: `import { test } from "node:test";\nimport assert from "node:assert/strict";\nimport * as calc from "../src/calc.mjs";\ntest("f only", () => {\n  assert.equal(calc.f(), 1);\n});\n`,
  });
  const r = await runGate({ root: f.dir, eventPath: f.eventPath, githubSha: f.head, env: process.env });
  assert.equal(r.code, 0);
  assert.equal(r.report.tests[0].condition, "imports");
});

test("a test that touches no changed line and imports none names none", async () => {
  const f = fixtureRepo({
    headSource: WITH_G,
    testText: `import { test } from "node:test";\nimport {deepEqual} from "node:assert/strict";\ntest("unrelated", () => {\n  deepEqual(1, 1);\n});\n`,
  });
  const r = await runGate({ root: f.dir, eventPath: f.eventPath, githubSha: f.head, env: process.env });
  assert.equal(r.code, 0);
  assert.equal(r.report.tests[0].condition, "none");
});
