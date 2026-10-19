// The entry (packages/action/src/index.mjs) must exit with runGate's numeric
// code; before the lead's 5083 fault 2 it handed the { code, report } object
// to process.exit and the run crashed with ERR_INVALID_ARG_TYPE. This test
// runs the real entry as a subprocess on a real workspace.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const indexPath = new URL("../src/index.mjs", import.meta.url).pathname;

const git = (...a) => execFileSync("git", a, { encoding: "utf8" }).trim();

function workspace() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "act03-entry-"));
  const cfg = ["-C", dir, "-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "maintenance.auto=false", "-c", "gc.auto=0"];
  git(...cfg, "init", "-b", "main");
  fs.writeFileSync(path.join(dir, "f.txt"), "one\n");
  git(...cfg, "add", ".");
  git(...cfg, "commit", "-q", "-m", "one");
  const base = git(...cfg, "rev-parse", "HEAD");
  fs.writeFileSync(path.join(dir, "f.txt"), "two\n");
  git(...cfg, "add", ".");
  git(...cfg, "commit", "-q", "-m", "two");
  const head = git(...cfg, "rev-parse", "HEAD");
  const eventPath = path.join(dir, "event.json");
  fs.writeFileSync(eventPath, JSON.stringify({ pull_request: { head: { sha: head }, base: { sha: base } } }));
  return { dir, cfg, base, head, eventPath };
}

test("the entry exits with the gate's numeric code, never the object", () => {
  const w = workspace();
  let status = null;
  let stderr = "";
  try {
    execFileSync(process.execPath, [indexPath], {
      env: {
        ...process.env,
        GITHUB_EVENT_NAME: "pull_request",
        GITHUB_EVENT_PATH: w.eventPath,
        GITHUB_WORKSPACE: w.dir,
        GITHUB_REPOSITORY: "o/r",
        INPUT_CONFIG: "definitely-missing.yml",
      },
      encoding: "utf8",
    });
    status = 0;
  } catch (error) {
    status = error.status;
    stderr = String(error.stderr ?? "");
  }
  assert.equal(typeof status, "number", `the entry did not exit with a number (status ${status})`);
  assert.ok(!stderr.includes("ERR_INVALID_ARG_TYPE"), "the object reached process.exit");
  assert.equal(status, 0, "the gate's code for a workspace with no changed tests is neutral 0");
});
