// REL-P2-AC01: the mirror writes exactly the five paths from the source
// files, the same bytes on two runs, and refuses when a source file is
// missing. The source root is a parameter, so the test drives the tool on a
// fixture without touching the repository.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const TOOL = "tools/mirror-action.mjs";
const ROOT = path.resolve(path.dirname(decodeURIComponent(new URL(import.meta.url).pathname)), "../..");

function fixtureSource({ missing } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mirror-src-"));
  const files = {
    "packages/action/action.yml": "name: truedone\n",
    "packages/action/dist/index.mjs": "// the bundled action\n",
    "packages/action/README.md": "# action\n\nThe GitHub Action lives in this package.\n",
    LICENSE: "Apache-2.0\n",
    NOTICE: "NOTICE\n",
  };
  for (const [p, text] of Object.entries(files)) {
    if (missing === p) continue;
    fs.mkdirSync(path.join(dir, path.dirname(p)), { recursive: true });
    fs.writeFileSync(path.join(dir, p), text);
  }
  return { dir, files };
}

function run(out, source) {
  execFileSync(process.execPath, [TOOL, out, "--source", source], { cwd: ROOT, encoding: "utf8" });
}

test("the mirror writes exactly the five paths, and two runs give the same bytes", (t) => {
  const { dir } = fixtureSource();
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "mirror-out-"));
  t.after(() => { fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(out, { recursive: true, force: true }); });
  run(out, dir);
  const paths = ["action.yml", "dist/index.mjs", "README.md", "LICENSE", "NOTICE"];
  assert.deepEqual(
    fs.readdirSync(out).sort(),
    ["LICENSE", "NOTICE", "README.md", "action.yml", "dist"],
    "exactly the five paths at the root, nothing else",
  );
  assert.equal(fs.existsSync(path.join(out, "dist/index.mjs")), true, "the action's bundle sits under dist/");
  const readme = fs.readFileSync(path.join(out, "README.md"), "utf8");
  assert.ok(readme.includes("uses: Truedone/truedone-action@v0.1.0"), "the usage reads the release tag");
  assert.ok(readme.includes("pin the commit the tag names"), "the usage says how to pin the commit");
  const first = paths.map((p) => fs.readFileSync(path.join(out, p), "utf8"));
  run(out, dir);
  const second = paths.map((p) => fs.readFileSync(path.join(out, p), "utf8"));
  assert.deepEqual(first, second, "two runs give the same bytes");
});

test("the mirror refuses when a source file is missing", (t) => {
  const { dir } = fixtureSource({ missing: "LICENSE" });
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "mirror-out-"));
  t.after(() => { fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(out, { recursive: true, force: true }); });
  assert.throws(() => run(out, dir), /LICENSE/);
});
