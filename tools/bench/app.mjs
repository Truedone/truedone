#!/usr/bin/env node
// The APP-06 app bench (AC02, AC03): opens 30 seeded pull requests in the
// sandbox and prints {"prs": [numbers]} on the last line. The latency is
// measured from GitHub's own issue events by the contract's verifier command,
// not here — this script only creates the PRs the events belong to.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const repo = process.argv.includes("--repo")
  ? process.argv[process.argv.indexOf("--repo") + 1]
  : "Truedone/truedone-sandbox";
const prs = process.argv.includes("--prs") ? Number(process.argv[process.argv.indexOf("--prs") + 1]) : 30;

const gh = (...a) => execFileSync("gh", a, { encoding: "utf8" }).trim();

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bench-app-"));
try {
  execFileSync("gh", ["repo", "clone", repo, dir, "--", "--depth=1"], { stdio: "inherit" });
  const git = (...a) => execFileSync("git", a, { encoding: "utf8" }).trim();
  const cfg = ["-C", dir, "-c", "user.name=truedone-lane-d", "-c", "user.email=rgillespie83@icloud.com"];
  fs.mkdirSync(path.join(dir, "src", "smoke"), { recursive: true });
  fs.mkdirSync(path.join(dir, "test"), { recursive: true });
  fs.writeFileSync(path.join(dir, "src", "smoke", "mul.mjs"), "export const mul = (a, b) => a * b;\n");
  fs.writeFileSync(
    path.join(dir, "test", "smoke.test.mjs"),
    `import { test } from "node:test";\nimport assert from "node:assert/strict";\nimport * as smoke from "../src/smoke/mul.mjs";\ntest("mul multiplies", () => {\n  assert.equal(smoke.mul(2, 3), 6);\n});\n`,
  );
  let mul = "export const mul = (a, b) => a * b;\n";
  let tests = `import { test } from "node:test";\nimport assert from "node:assert/strict";\nimport * as smoke from "../src/smoke/mul.mjs";\n`;
  const numbers = [];
  for (let i = 1; i <= prs; i++) {
    const branch = `bench-${Date.now()}-${i}`;
    git(...cfg, "checkout", "-q", "-b", branch);
    // Each PR's files are written whole after the checkout (lane-b's review
    // item 2): the default branch does not carry them, so appending to the
    // previous state broke the second PR with a missing file.
    mul += `export const v${i} = ${i};\n`;
    tests += `test("v${i} is ${i}", () => { assert.equal(smoke.v${i}, ${i}); });\n`;
    fs.mkdirSync(path.join(dir, "src", "smoke"), { recursive: true });
    fs.mkdirSync(path.join(dir, "test"), { recursive: true });
    fs.writeFileSync(path.join(dir, "src", "smoke", "mul.mjs"), mul);
    fs.writeFileSync(path.join(dir, "test", "smoke.test.mjs"), tests);
    git(...cfg, "add", ".");
    git(...cfg, "commit", "-q", "-m", `bench: seeded pull request ${i}`);
    execFileSync("git", [...cfg, "push", "-q", "origin", branch], { stdio: "inherit" });
    const url = gh("pr", "create", "-R", repo, "--head", branch, "--title", `bench: pull request ${i}`, "--body", "Seeded by tools/bench/app.mjs.");
    const n = Number(url.match(/\/pull\/(\d+)/)?.[1] ?? url.match(/\/(\d+)$/)?.[1] ?? 0);
    if (!n) {
      console.error(`truedone: could not read the pull request number from ${url}`);
      process.exit(1);
    }
    numbers.push(n);
    git(...cfg, "checkout", "-q", "-");
  }
  // The bench closes what it opened after their labels arrive (the lead's
  // fold 3 of 4315): the runs leave no litter. The wait is bounded.
  const labeled = new Set();
  const deadline = Date.now() + 10 * 60_000;
  while (Date.now() < deadline && labeled.size < numbers.length) {
    for (const n of numbers) {
      if (labeled.has(n)) continue;
      const labels = JSON.parse(gh("pr", "view", String(n), "-R", repo, "--json", "labels")).labels.map((l) => l.name);
      const mine = labels.find((x) => x.startsWith("truedone:"));
      if (mine) labeled.add(n);
    }
    if (labeled.size < numbers.length) execFileSync("sleep", ["15"]);
  }
  for (const n of numbers) {
    gh("pr", "close", String(n), "-R", repo, "--delete-branch");
  }
  console.log(JSON.stringify({ prs: numbers }));
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
