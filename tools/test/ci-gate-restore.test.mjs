// SEC-03-AC02: on a temporary repository with the real git, the restored
// proofline.json, proofline.json.sig and guard/ are byte-exact with
// origin/main after restoreContract() runs.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { restoreContract } from "../ci-gate.mjs";

const git = (...a) => execFileSync("git", a.flat(), { encoding: "utf8" });
const PATHS = ["proofline.json", "proofline.json.sig", "guard/owner.pub"];

test("restoreContract restores the three contract paths byte-exact", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sec03res-"));
  const origin = path.join(dir, "origin.git");
  const work = path.join(dir, "work");
  const cfg = ["-c", "user.name=t", "-c", "user.email=t@example.com"];
  const cwd = process.cwd();
  try {
    git(["init", "--bare", "-b", "main", origin]);
    git(["clone", origin, work]);
    process.chdir(work);
    fs.writeFileSync("proofline.json", '{"tasks": []}\n');
    fs.writeFileSync("proofline.json.sig", "signature-bytes\n");
    fs.mkdirSync("guard", { recursive: true });
    fs.writeFileSync("guard/owner.pub", "owner-public-key\n");
    git(cfg, ["add", "."]);
    git(cfg, ["commit", "-m", "seed"]);
    git(["push", "origin", "main"]);
    const bytes = Object.fromEntries(PATHS.map((p) => [p, fs.readFileSync(p)]));

    // the working copies drift on the branch
    fs.writeFileSync("proofline.json", "{}\n");
    fs.writeFileSync("proofline.json.sig", "tampered\n");
    fs.rmSync("guard", { recursive: true, force: true });
    fs.mkdirSync("guard", { recursive: true });
    fs.writeFileSync("guard/owner.pub", "tampered\n");

    restoreContract(git(["rev-parse", "origin/main"]).trim());

    for (const p of PATHS) {
      assert.ok(bytes[p].equals(fs.readFileSync(p)), `${p} is byte-exact`);
    }
  } finally {
    process.chdir(cwd);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
