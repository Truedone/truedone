// The FOLD's pin (the lead, 4236): each smoke closes the pull request it
// opened and deletes its branch when it ends, pass or fail. A fake gh on
// PATH records the calls; on the pass outcome and on the timed-out outcome
// the recorded calls must include pr close with --delete-branch.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const TOOL = "tools/smoke-app.mjs";
const ROOT = path.resolve(path.dirname(decodeURIComponent(new URL(import.meta.url).pathname)), "../../..");

function shimDir(t, { labeled, actor }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "smoke-shim-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const log = path.join(dir, "gh-log");
  const bin = path.join(dir, "bin");
  fs.mkdirSync(bin);
  // The fake gh: records every call, answers the clone by making a local
  // git repository with a bare origin so the script's push stays local, and
  // answers the label view out of the fixture.
  const gh = [
    "#!/bin/sh",
    `echo "gh $*" >> ${JSON.stringify(log)}`,
    'if [ "$1" = "repo" ] && [ "$2" = "clone" ]; then',
    '  d="$4"; mkdir -p "$d" "$d.upstream"',
    '  git -C "$d.upstream" init -q --bare -b main',
    '  git -C "$d.upstream" -c user.name=t -c user.email=t@e commit -q --allow-empty -m init',
    '  git -C "$d" init -q -b main',
    '  git -C "$d" remote add origin "$d.upstream"',
    '  git -C "$d" fetch -q origin',
    '  git -C "$d" checkout -q -b main origin/main',
    "  exit 0",
    "fi",
    'if [ "$1" = "pr" ] && [ "$2" = "create" ]; then echo "https://github.com/o/r/pull/7"; exit 0; fi',
    'if [ "$1" = "pr" ] && [ "$2" = "close" ]; then exit 0; fi',
    'if [ "$1" = "pr" ] && [ "$2" = "view" ]; then',
    `  if [ "$TRUEDONE_LABELED" = 1 ]; then echo '{"labels":[{"name":"truedone:unrun"}]}'; else echo '{"labels":[]}'; fi`,
    "  exit 0",
    "fi",
    'if [ "$1" = "api" ]; then',
    `  if [ "$TRUEDONE_LABELED" = 1 ]; then echo '[{"event":"labeled","label":{"name":"truedone:unrun"},"actor":{"login":"${actor}"}}]'; else echo '[]'; fi`,
    "  exit 0",
    "fi",
    "exit 0",
  ].join("\n");
  fs.writeFileSync(path.join(bin, "gh"), gh);
  fs.chmodSync(path.join(bin, "gh"), 0o755);
  return { bin, log };
}

function runSmoke(t, { bin, labeled, actor }) {
  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    TRUEDONE_LABELED: labeled ? "1" : "0",
    TRUEDONE_SMOKE_WAIT_SECONDS: "2",
  };
  try {
    execFileSync(process.execPath, [TOOL, "--repo", "o/r"], { cwd: ROOT, env, encoding: "utf8" });
  } catch (error) {
    // The failing outcomes exit 1 on purpose; the recorded calls are the test.
    // A crash before the close is not: its stderr names the real cause.
    fs.appendFileSync(path.join(bin, "..", "gh-log"), `SMOKE-STDERR: ${error.stderr ?? ""}\nSMOKE-MESSAGE: ${error.message}\n`);
  }
  return fs.readFileSync(path.join(bin, "..", "gh-log"), "utf8");
}

test("on the passing outcome the smoke closes the pull request and deletes the branch", (t) => {
  const log = runSmoke(t, { ...shimDir(t, { labeled: true, actor: "truedone-dev[bot]" }), labeled: true, actor: "truedone-dev[bot]" });
  assert.match(log, /gh pr close 7 -R o\/r --delete-branch/);
});

test("on the timed-out outcome the smoke still closes the pull request and deletes the branch", (t) => {
  const log = runSmoke(t, { ...shimDir(t, { labeled: false, actor: "" }), labeled: false, actor: "" });
  assert.match(log, /gh pr close 7 -R o\/r --delete-branch/);
});

test("a hand-set label from a non-App actor fails the run and still closes the pull request", (t) => {
  const log = runSmoke(t, { ...shimDir(t, { labeled: true, actor: "mgillr" }), labeled: true, actor: "mgillr" });
  assert.match(log, /gh pr close 7 -R o\/r --delete-branch/);
});
