// SEC-02: main()'s changed-files step runs with the real git on a temporary
// repository: an origin/main and a branch that adds, changes and removes files.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { listChangedFiles, PROOFLINE_PIN } from "../ci-gate.mjs";

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
    const mainSha = git(["rev-parse", "origin/main"]).trim();
    assert.deepEqual(listChangedFiles(mainSha).sort(), ["added.txt", "changed.txt", "removed.txt"]);
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

// The end-to-end fixture cases (SEC-03): a temporary repository with its own
// owner key signs a minimal contract whose task has one passing criterion and
// one env-bound failing one; the child gate process decides.

const HERE = path.dirname(new URL(import.meta.url).pathname);
const GATE = path.join(HERE, "..", "ci-gate.mjs");

function seed(dir) {
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "fixture", private: true }));
  execFileSync("npm", ["install", `@optitransfer/proofline@${PROOFLINE_PIN.replace("@optitransfer/proofline@", "")}`, "@optitransfer/agentkey", "--no-save", "--no-package-lock", "--silent"], { cwd: dir, stdio: "ignore" });
}

test("the fixture gate: green passes, a failing non-env-bound criterion fails, a contract edit fails", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sec03fx-"));
  const origin = path.join(dir, "origin.git");
  const work = path.join(dir, "work");
  const cfg = ["-c", "user.name=t", "-c", "user.email=t@example.com"];
  const cwd = process.cwd();
  const keyHome = path.join(dir, "keyhome");
  fs.mkdirSync(keyHome, { recursive: true });
  const fixtureEnv = () => ({ ...process.env, AGENTKEY_HOME: keyHome, PATH: `${path.join(work, "node_modules", ".bin")}${path.delimiter}${process.env.PATH ?? ""}` });
  const pl = (...a) => execFileSync(path.join(work, "node_modules", ".bin", "proofline"), a, { cwd: work, encoding: "utf8", env: fixtureEnv() });
  try {
    git(["init", "--bare", "-b", "main", origin]);
    git(["clone", origin, work]);
    process.chdir(work);
    seed(work);
    pl("setup", "--agent", "none");
    const contract = JSON.parse(fs.readFileSync("proofline.json", "utf8"));
    contract.tasks = [{
      id: "FIX-01",
      title: "the fixture task",
      phase: "implement",
      owner: "truedone-lane-d",
      scope: { allow: ["packages/**", "tools/**"] },
      criteria: [
        { id: "FIX-01-AC01", mandatory: true, statement: "passes while tools/broken.txt is absent", verifier: { type: "command", cmd: "test ! -e tools/broken.txt", expect_exit: 0, timeout_s: 60 } },
        { id: "FIX-01-AC02", mandatory: true, statement: "env-bound and failing on purpose", verifier: { type: "command", cmd: "node -e 'process.exit(1)'", expect_exit: 0, timeout_s: 60 } },
      ],
    }];
    contract.ci = { env_bound: { "FIX-01": ["FIX-01-AC02"] } };
    fs.writeFileSync("proofline.json", JSON.stringify(contract, null, 2) + "\n");
    pl("contract", "sign");
    pl("contract", "verify-sig");
    git(cfg, ["add", "."]);
    git(cfg, ["commit", "-m", "seed"]);
    git(["push", "origin", "main"]);
    const sigBytes = fs.readFileSync("proofline.json.sig");

    const gate = (over = {}) => {
      try {
        return execFileSync(process.execPath, [GATE], { cwd: work, env: { ...process.env, PR_TITLE: "FIX-01: the fixture task", AGENTKEY_HOME: keyHome, ...over }, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
      } catch (e) {
        const err = new Error(`gate exit ${e.status}: ${(e.stdout ?? "").slice(0, 800)} | ${(e.stderr ?? "").slice(0, 800)}`);
        err.status = e.status;
        err.stdout = e.stdout;
        err.stderr = e.stderr;
        throw err;
      }
    };
    const run = () => gate();

    // green: the non-env-bound criterion passes, the env-bound one fails on purpose
    gate();
    assert.ok(sigBytes.equals(fs.readFileSync("proofline.json.sig")), "the signature is byte-exact after a run");

    // a failing non-env-bound criterion: a source change makes AC01 fail, and the contract is untouched
    fs.mkdirSync("tools", { recursive: true });
    fs.writeFileSync("tools/broken.txt", "the file AC01 must not find\n");
    git(cfg, ["add", "."]);
    // its message carries a Proofline-Base trailer, which must not displace the merge base
    git(cfg, ["commit", "-m", "breaking\n\nProofline-Base: 0000000000000000000000000000000000000000"]);
    let code = 0;
    let said = "";
    try { run(); } catch (e) { code = e.status; said = `${e.stdout ?? ""}${e.stderr ?? ""}`; }
    assert.equal(code, 1, "a failing non-env-bound criterion exits 1");
    assert.match(said, /FIX-01-AC01 is fail and not env-bound/, "the gate names the failing criterion");
    git(cfg, ["revert", "--no-edit", "HEAD"]);
    const back = execFileSync(process.execPath, [GATE], { cwd: work, env: { ...process.env, PR_TITLE: "FIX-01: the fixture task", AGENTKEY_HOME: keyHome }, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    assert.match(back, /the four conditions hold/, "the gate passes again once the breaking change is reverted");

    // a contract edit on the branch
    const fixTask = contract.tasks[0];
    contract.tasks.pop();
    fs.writeFileSync("proofline.json", JSON.stringify(contract, null, 2) + "\n");
    pl("contract", "sign");
    git(cfg, ["add", "."]);
    // a pull request author has no proofline hook, so the fixture's own pre-commit hook is bypassed for this
    // commit and the next; the gate under test is the only guard, and nothing here is landed anywhere
    git(cfg.concat(["-c", "core.hooksPath=/dev/null"]), ["commit", "-m", "weakening"]);
    code = 0;
    try { run(); } catch (e) { code = e.status; }
    assert.equal(code, 1, "a contract edit versus base exits 1");

    // the id only in a task-level field: the failure counts
    contract.tasks = [{ ...fixTask }];
    delete contract.ci;
    fs.writeFileSync("proofline.json", JSON.stringify(contract, null, 2) + "\n");
    pl("contract", "sign");
    git(cfg, ["add", "."]);
    git(cfg.concat(["-c", "core.hooksPath=/dev/null"]), ["commit", "-m", "task-level-only"]);
    code = 0;
    try { execFileSync(process.execPath, [GATE], { cwd: work, env: { ...process.env, PR_TITLE: "FIX-01: the fixture task", AGENTKEY_HOME: keyHome }, encoding: "utf8", stdio: ["ignore", "ignore", "ignore"] }); } catch (e) { code = e.status; }
    assert.equal(code, 1, "a task-level-only env-bound id does not excuse the failure");

    // origin/main without owner.pub fails the gate
    git(cfg, ["checkout", "main"]);
    git(cfg, ["rm", "guard/owner.pub"]);
    git(cfg.concat(["-c", "core.hooksPath=/dev/null"]), ["commit", "-m", "no key"]);   // a tampered main is the state under test
    git(cfg, ["push", "origin", "main"]);
    git(cfg, ["checkout", "-B", "task"]);
    code = 0;
    try { execFileSync(process.execPath, [GATE], { cwd: work, env: { ...process.env, PR_TITLE: "FIX-01: the fixture task", AGENTKEY_HOME: keyHome }, encoding: "utf8", stdio: ["ignore", "ignore", "ignore"] }); } catch (e) { code = e.status; }
    assert.equal(code, 1, "origin/main without owner.pub fails the gate");
  } finally {
    process.chdir(cwd);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
