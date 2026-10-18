// SEC-03-AC03: with no guard/owner.pub at origin/main, or verify-sig output
// without "owner signature matches", the gate fails.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const GATE = path.join(path.dirname(new URL(import.meta.url).pathname), "..", "ci-gate.mjs");
const git = (...a) => execFileSync("git", a.flat(), { encoding: "utf8" });

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sec03key-"));
  const origin = path.join(dir, "origin.git");
  const work = path.join(dir, "work");
  const cfg = ["-c", "user.name=t", "-c", "user.email=t@example.com"];
  git(["init", "--bare", "-b", "main", origin]);
  git(["clone", origin, work]);
  const cwd = process.cwd();
  process.chdir(work);
  try {
    fs.writeFileSync("package.json", JSON.stringify({ name: "fixture", private: true }));
    execFileSync("npm", ["install", "@optitransfer/proofline@0.2.0-next.1", "@optitransfer/agentkey", "--no-save", "--no-package-lock", "--silent"], { cwd: work, stdio: "ignore" });
    const keyHome = path.join(dir, "keyhome");
    fs.mkdirSync(keyHome, { recursive: true });
    const env = { cwd: work, encoding: "utf8", env: { ...process.env, AGENTKEY_HOME: keyHome, PATH: `${path.join(work, "node_modules", ".bin")}${path.delimiter}${process.env.PATH ?? ""}` } };
    const pl = (...a) => execFileSync(path.join(work, "node_modules", ".bin", "proofline"), a, env);
    pl("setup", "--agent", "none");
    const contract = JSON.parse(fs.readFileSync("proofline.json", "utf8"));
    contract.tasks = [{
      id: "FIX-01",
      title: "the fixture task",
      phase: "implement",
      owner: "truedone-lane-d",
      scope: { allow: ["packages/**"] },
      criteria: [
        { id: "FIX-01-AC01", mandatory: true, statement: "passes", verifier: { type: "command", cmd: "node -e 'process.exit(0)'", expect_exit: 0, timeout_s: 60 } },
      ],
    }];
    contract.ci = { env_bound: { "FIX-01": [] } };
    fs.writeFileSync("proofline.json", JSON.stringify(contract, null, 2) + "\n");
    pl("contract", "sign");
    pl("contract", "verify-sig");
    git(cfg, ["add", "."]);
    git(cfg, ["commit", "-m", "seed"]);
    git(["push", "origin", "main"]);
    git(["checkout", "-b", "task"]);
    return { dir, work, keyHome, env: { ...process.env, PR_TITLE: "FIX-01: the fixture task", AGENTKEY_HOME: keyHome }, cfg };
  } catch (e) {
    process.chdir(cwd);
    fs.rmSync(dir, { recursive: true, force: true });
    throw e;
  }
}

test("with no guard/owner.pub at origin/main the gate fails", () => {
  const f = fixture();
  try {
    git(f.cfg, ["checkout", "main"]);
    git(f.cfg, ["rm", "guard/owner.pub"]);
    git(f.cfg, ["commit", "-m", "no key"]);
    git(["push", "origin", "main"]);
    git(f.cfg, ["checkout", "task"]);
    let code = 0;
    let captured = "";
    try { execFileSync(process.execPath, [GATE], { cwd: f.work, env: f.env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }); } catch (e) { code = e.status; captured = `${e.stdout ?? ""}${e.stderr ?? ""}`; }
    assert.equal(code, 1, "origin/main without owner.pub fails the gate");
    assert.match(captured, /guard\/owner\.pub is missing/, "the gate names the missing key");
  } finally {
    process.chdir(os.tmpdir());
    fs.rmSync(f.dir, { recursive: true, force: true });
  }
});

test("with an armed signature that does not match, the gate fails", () => {
  const f = fixture();
  try {
    // the mismatch is pushed to origin/main itself: main carries the new
    // contract beside the old signature, so the restore cannot undo it
    git(f.cfg, ["checkout", "main"]);
    const contract = JSON.parse(fs.readFileSync("proofline.json", "utf8"));
    contract.tasks[0].title = "edited on main after signing";
    fs.writeFileSync("proofline.json", JSON.stringify(contract, null, 2) + "\n");
    git(f.cfg, ["add", "."]);
    // the mismatched pair is the state under test, so the fixture's own commit
    // bypasses the hook that would refuse it; nothing here is landed anywhere
    git(f.cfg.concat(["-c", "core.hooksPath=/dev/null"]), ["commit", "-m", "edited on main"]);
    git(f.cfg.concat(["-c", "core.hooksPath=/dev/null"]), ["push", "origin", "main"]);
    git(f.cfg, ["checkout", "-B", "task", "main"]);
    let code = 0;
    let captured = "";
    try { execFileSync(process.execPath, [GATE], { cwd: f.work, env: f.env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }); } catch (e) { code = e.status; captured = `${e.stdout ?? ""}${e.stderr ?? ""}`; }
    assert.equal(code, 1, "an armed mismatch fails the gate");
    assert.ok(/owner signature matches/.test(captured), "the gate named the missing owner-signature report");
  } finally {
    process.chdir(os.tmpdir());
    fs.rmSync(f.dir, { recursive: true, force: true });
  }
});
