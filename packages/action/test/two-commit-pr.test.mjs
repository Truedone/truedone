// The lead's 5261, both checkout shapes against local remotes, with a
// two-commit pull request (module then test):
// - a merge commit checked out at depth 1: the base is its FIRST PARENT and
//   the change set is the two-dot set HEAD^1..HEAD, exactly the PR's files.
// - a head checkout: the base is pull_request.base.sha, fetched by sha.
// In both shapes the module is absent from the base tree, so the swap removes
// it on the base leg and the seeded test fails to load there: the base leg
// fails, which is what RUN-07's expansion turns into the red side.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveBase } from "../src/main.mjs";

const git = (...a) => execFileSync("git", a, { encoding: "utf8" }).trim();
const gitOk = (a, cwd) => { try { execFileSync("git", a, { cwd, stdio: "pipe" }); return true; } catch { return false; } };

function twoCommitWithMerge() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "act03-shapes-"));
  const cfg = ["-C", dir, "-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "maintenance.auto=false", "-c", "gc.auto=0"];
  git("init", "-q", "-b", "main", dir);
  fs.writeFileSync(path.join(dir, "README.md"), "seed\n");
  git(...cfg, "add", ".");
  git(...cfg, "commit", "-q", "-m", "seed");
  const base = git(...cfg, "rev-parse", "HEAD");
  git(...cfg, "checkout", "-q", "-b", "pr");
  fs.mkdirSync(path.join(dir, "src", "smoke"), { recursive: true });
  fs.writeFileSync(path.join(dir, "src", "smoke", "mul.mjs"), "export const mul = (a, b) => a * b;\n");
  git(...cfg, "add", ".");
  git(...cfg, "commit", "-q", "-m", "smoke: the module under test");
  const prTip = git(...cfg, "rev-parse", "HEAD");
  fs.mkdirSync(path.join(dir, "node-test"), { recursive: true });
  fs.writeFileSync(path.join(dir, "node-test", "smoke.test.mjs"), 'import * as smoke from "../src/smoke/mul.mjs";\ntest("mul multiplies", () => {});\n');
  git(...cfg, "add", ".");
  git(...cfg, "commit", "-q", "-m", "smoke: a seeded red-green pull request");
  const head = git(...cfg, "rev-parse", "HEAD");
  git(...cfg, "checkout", "-q", "main");
  git(...cfg, "merge", "-q", "--no-ff", "-m", "Merge the smoke pull request", "pr");
  const merge = git(...cfg, "rev-parse", "HEAD");
  return { dir, cfg, base, prTip, head, merge };
}

function eventFile(dir, event) {
  const p = path.join(dir, "event.json");
  fs.writeFileSync(p, JSON.stringify(event));
  return p;
}

function changedFilesAt(base, cwd) {
  const diffOut = execFileSync("git", ["diff", "--name-status", base, "HEAD"], { cwd, encoding: "utf8" }).trim();
  const out = [];
  for (const line of diffOut.split("\n").filter(Boolean)) {
    const [status, from, to] = line.split("\t");
    out.push({ path: to || from, status: status === "A" ? "added" : status === "D" ? "deleted" : "modified" });
  }
  return out;
}

function shallowCloneOf(dir, sha, name) {
  const parent = path.dirname(dir);
  const shallow = path.join(parent, path.basename(dir) + "-" + name);
  git("init", "-q", shallow);
  git("-C", shallow, "remote", "add", "origin", `file://${dir}`);
  git("-C", shallow, "fetch", "-q", "--depth=2", "origin", sha);
  git("-C", shallow, "checkout", "-q", "--detach", "FETCH_HEAD");
  return shallow;
}

function assertShape(base, shallow) {
  const files = changedFilesAt(base, shallow);
  assert.deepEqual(
    files.map((f2) => ({ path: f2.path, status: f2.status })).sort((a, b) => a.path.localeCompare(b.path)),
    [
      { path: "node-test/smoke.test.mjs", status: "added" },
      { path: "src/smoke/mul.mjs", status: "added" },
    ],
    `the change set is the PR's two added files: ${JSON.stringify(files)}`,
  );
  // The module the PR adds is absent from the base tree: the swap removes it
  // on the base leg, so the seeded test fails to load there and the base leg
  // fails.
  assert.equal(gitOk(["cat-file", "-e", `${base}:src/smoke/mul.mjs`], shallow), false, "the module exists on the base tree");
  assert.equal(gitOk(["cat-file", "-e", `${base}:node-test/smoke.test.mjs`], shallow), false, "the test exists on the base tree");
}

test("a merge commit at depth 1: the base is its first parent and the change set is the PR's files", () => {
  const f = twoCommitWithMerge();
  const shallow = shallowCloneOf(f.dir, f.merge, "merge-shallow");
  const p = eventFile(shallow, { pull_request: { head: { sha: f.prTip } } });
  const r = resolveBase({ eventPath: p, cwd: shallow, githubSha: f.merge });
  assert.equal(r.base, f.base, "the base is the merge commit's first parent");
  assert.notEqual(r.base, f.prTip, "the base is not the PR's own earlier commit");
  assertShape(r.base, shallow);
  fs.rmSync(shallow, { recursive: true, force: true });
});

test("a head checkout: the base is pull_request.base.sha fetched by sha", () => {
  const f = twoCommitWithMerge();
  const shallow = shallowCloneOf(f.dir, f.head, "head-shallow");
  const p = eventFile(shallow, { pull_request: { base: { sha: f.base }, head: { sha: f.head } } });
  const r = resolveBase({ eventPath: p, cwd: shallow, githubSha: f.head });
  assert.equal(r.base, f.base, "the base is pull_request.base.sha");
  assertShape(r.base, shallow);
  fs.rmSync(shallow, { recursive: true, force: true });
});
