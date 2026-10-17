// SEC-02: main()'s changed-files step runs with the real git on a temporary
// repository: an origin/main and a branch that adds, changes and removes files.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { listChangedFiles } from "../ci-gate.mjs";

const git = (...a) => execFileSync("git", a.flat(), { encoding: "utf8" });

test("the changed-files step lists added, changed and removed files against origin/main", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sec02-"));
  const origin = path.join(dir, "origin.git");
  const work = path.join(dir, "work");
  const cfg = ["-c", "user.name=t", "-c", "user.email=t@example.com"];
  const cwd = process.cwd();
  try {
    git(["init", "--bare", "-b", "main", origin]);
    git(["clone", origin, work]);
    process.chdir(work);
    fs.writeFileSync(path.join(work, "changed.txt"), "v1");
    fs.writeFileSync(path.join(work, "removed.txt"), "r");
    git(cfg, ["add", "."]);
    git(cfg, ["commit", "--allow-empty", "-m", "base"]);
    git(["push", "origin", "main"]);
    git(["checkout", "-b", "task"]);
    fs.writeFileSync(path.join(work, "added.txt"), "a");
    fs.writeFileSync(path.join(work, "changed.txt"), "v2");
    fs.rmSync(path.join(work, "removed.txt"));
    git(cfg, ["add", "-A"]);
    git(cfg, ["commit", "-m", "one"]);
    assert.deepEqual(listChangedFiles().sort(), ["added.txt", "changed.txt", "removed.txt"]);
  } finally {
    process.chdir(cwd);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("no git call passes merge-base as a revision", () => {
  const src = fs.readFileSync(new URL("../ci-gate.mjs", import.meta.url), "utf8");
  for (const m of src.matchAll(/sh\(\[([^\]]*)\]\)/g)) {
    const args = m[1].split(",").map((s) => s.trim().replace(/^['"]|['"]$/g, ""));
    if (args[0] === "diff") assert.ok(!args.slice(1).includes("merge-base"), m[0]);
  }
});
