import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { resolveBase } from "../src/main.mjs";

// ACT-03-AC01 (D6): the base is the checked-out merge commit's FIRST PARENT,
// never the event's pull_request.base field.

const git = (...a) => execFileSync("git", a, { encoding: "utf8" }).trim();

function fixtureRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "act03-base-"));
  const cfg = ["-C", dir, "-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "maintenance.auto=false", "-c", "gc.auto=0"];
  git(...cfg, "init", "-b", "main");
  fs.writeFileSync(path.join(dir, "f.txt"), "one\n");
  git(...cfg, "add", ".");
  git(...cfg, "commit", "-q", "-m", "a");
  const a = git(...cfg, "rev-parse", "HEAD");
  git(...cfg, "checkout", "-q", "-b", "side");
  fs.writeFileSync(path.join(dir, "g.txt"), "side\n");
  git(...cfg, "add", ".");
  git(...cfg, "commit", "-q", "-m", "b");
  const b = git(...cfg, "rev-parse", "HEAD");
  git(...cfg, "checkout", "-q", "main");
  fs.writeFileSync(path.join(dir, "f.txt"), "main-two\n");
  git(...cfg, "add", ".");
  git(...cfg, "commit", "-q", "-m", "m2");
  const m = git(...cfg, "rev-parse", "HEAD");
  git(...cfg, "merge", "-q", "--no-ff", "-m", "merge", "side");
  const merge = git(...cfg, "rev-parse", "HEAD");
  return { dir, cfg, a, b, m, merge };
}

function eventFile(dir, event) {
  const p = path.join(dir, "event.json");
  fs.writeFileSync(p, JSON.stringify(event));
  return p;
}

test("a merge checkout: the base is the merge commit's first parent (the lead's 5261)", () => {
  const f = fixtureRepo();
  const p = eventFile(f.dir, { pull_request: { head: { sha: "prhead" }, base: { sha: f.b }, merge_commit_sha: f.merge } });
  const r = resolveBase({ eventPath: p, cwd: f.dir, githubSha: f.merge });
  assert.equal(r.base, f.m, "the first parent of the merge commit is the base");
  assert.equal(r.prHead, "prhead", "the report carries the PR head sha");
});

// ACT-03 (lane-b's review item 7): actions/checkout fetches the merge commit
// at depth 1, so the first parent is missing. resolveBase deepens by one
// through origin and finds it; red on main, which threw instead.
test("a shallow merge checkout deepens the merge commit by sha so its first parent resolves", () => {
  const f = fixtureRepo();
  const shallow = path.join(f.dir, "..", path.basename(f.dir) + "-shallow");
  git("clone", "-q", "--depth=1", `file://${f.dir}`, shallow);
  git("-C", shallow, "fetch", "-q", "origin", `${f.merge}`); // actions/checkout has the merge commit itself
  const p = eventFile(shallow, { pull_request: { head: { sha: "prhead" }, base: { sha: f.b }, merge_commit_sha: f.merge } });
  const r = resolveBase({ eventPath: p, cwd: shallow, githubSha: f.merge });
  assert.equal(r.base, f.m, "the deepened merge commit yields its first parent");
});

test("GITHUB_SHA names the checked-out commit when the event omits merge_commit_sha", () => {
  const f = fixtureRepo();
  const p = eventFile(f.dir, { pull_request: { head: { sha: "prhead" } } });
  const r = resolveBase({ eventPath: p, cwd: f.dir, githubSha: f.merge });
  assert.equal(r.base, f.m);
});

test("the event's merge_commit_sha is the fallback when GITHUB_SHA is absent", () => {
  const f = fixtureRepo();
  const p = eventFile(f.dir, { pull_request: { head: { sha: "prhead" }, merge_commit_sha: f.merge } });
  const r = resolveBase({ eventPath: p, cwd: f.dir, githubSha: undefined });
  assert.equal(r.base, f.m);
});

test("a checked-out commit with no first parent refuses", () => {
  const f = fixtureRepo();
  const p = eventFile(f.dir, { pull_request: { merge_commit_sha: f.a } });
  assert.throws(() => resolveBase({ eventPath: p, cwd: f.dir, githubSha: f.a }), /no first parent/);
});

test("a linear history's first parent is the base, which is what a merge commit gives in CI", () => {
  const f = fixtureRepo();
  const p = eventFile(f.dir, { pull_request: { head: { sha: "prhead" } } });
  const r = resolveBase({ eventPath: p, cwd: f.dir, githubSha: f.b });
  assert.equal(r.base, f.a);
});

test("a depth-1 detached checkout deepens by fetching the commit itself, not the remote's branches", () => {
  // The sandbox measured in the lead's 5083: actions/checkout fetches the
  // merge commit by sha into a detached shallow head, so the remote's
  // branches are absent and --deepen fetches those instead of this commit's
  // parent. The fix fetches the checked-out commit itself.
  const f = fixtureRepo();
  const parent = path.dirname(f.dir);
  const bare = path.join(parent, path.basename(f.dir) + "-bare.git");
  const shallow = path.join(parent, path.basename(f.dir) + "-shallow");
  git("clone", "-q", "--bare", f.dir, bare);
  git("init", "-q", shallow);
  git("-C", shallow, "remote", "add", "origin", bare);
  git("-C", shallow, "fetch", "-q", "--depth=1", "--no-tags", "origin", f.merge);
  git("-C", shallow, "checkout", "-q", "--detach", "FETCH_HEAD");
  const p = eventFile(f.dir, { pull_request: { head: { sha: "prhead" } } });
  const r = resolveBase({ eventPath: p, cwd: shallow, githubSha: f.merge });
  assert.equal(r.base, f.m, "the fetched-by-sha history gives the merge commit's first parent");
});
