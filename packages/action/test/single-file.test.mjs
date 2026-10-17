import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const HERE = path.dirname(decodeURIComponent(new URL(import.meta.url).pathname));
const ACTION = path.join(HERE, "..");
const REPO = path.resolve(ACTION, "../..");

test("action.yml runs using node24 with one built entry and two optional inputs", () => {
  const yml = fs.readFileSync(path.join(ACTION, "action.yml"), "utf8");
  assert.match(yml, /using:\s*node24/);
  assert.match(yml, /main:\s*dist\/index\.mjs/);
  assert.match(yml, /config:/);
  assert.match(yml, /timeout:/);
});

test("the source installs nothing: no package-manager call anywhere in it", () => {
  const src = fs.readFileSync(path.join(ACTION, "src", "index.mjs"), "utf8");
  assert.doesNotMatch(src, /npm (install|ci|i )|pip install|yarn add|pnpm add/);
});

test("the built entry is one self-contained file: no bare imports of unbundled paths", () => {
  const built = path.join(ACTION, "dist", "index.mjs");
  if (!fs.existsSync(built)) {
    execFileSync("node", ["tools/bundle.mjs"], { cwd: REPO, stdio: "inherit" });
  }
  const src = fs.readFileSync(built, "utf8");
  const imports = [...src.matchAll(/(?:^|\n)\s*(?:import|export)[^\n]*from\s*["']([^"']+)["']/g)].map((m) => m[1]);
  const bare = imports.filter((s) => !s.startsWith(".") && !s.startsWith("node:"));
  assert.deepEqual(bare, [], "the bundle imports nothing outside node: builtins");
});

test("the built action runs from its single file in an empty directory", () => {
  const built = path.join(ACTION, "dist", "index.mjs");
  if (!fs.existsSync(built)) {
    execFileSync("node", ["tools/bundle.mjs"], { cwd: REPO, stdio: "inherit" });
  }
  const empty = fs.mkdtempSync(path.join(REPO, "tools", "test", "empty-"));
  try {
    const out = execFileSync(process.execPath, [built], {
      cwd: empty,
      env: { ...process.env, GITHUB_EVENT_NAME: "push", GITHUB_REPOSITORY: "o/r" },
      encoding: "utf8",
    });
    assert.match(out, /skipping/, "a non-pull_request event skips with a message");
  } finally {
    fs.rmSync(empty, { recursive: true, force: true });
  }
});

test("the committed bundles match their sources: rebuilding leaves no diff", () => {
  execFileSync("node", ["tools/bundle.mjs"], { cwd: REPO, stdio: "inherit" });
  const status = execFileSync("git", ["status", "--porcelain", "packages/action/dist"], { cwd: REPO, encoding: "utf8" });
  assert.equal(status.trim(), "", "rebuilding the bundle changed nothing");
});
