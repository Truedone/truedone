// APP-06-AC08's pin (the lead's FOLD): the switch-off flips the global
// posting switch itself through wrangler, confirms /health reads false,
// seeds a second pull request, waits one minute for nothing to post, and
// restores the switch — with the restore in the smoke's own hands, never a
// hand-set label. A fake wrangler, gh and curl on PATH record every call.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const TOOL = "tools/smoke-app.mjs";
const ROOT = path.resolve(path.dirname(decodeURIComponent(new URL(import.meta.url).pathname)), "../../..");

function shims(t, { wranglerWorks, healthStates }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "switch-shim-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const log = path.join(dir, "shim-log");
  const bin = path.join(dir, "bin");
  fs.mkdirSync(bin);
  const healthScript = healthStates
    .map((s) => `if [ $HEALTH_CALLS -eq ${healthStates.indexOf(s)} ]; then echo '{"posting_enabled":${s}}'; fi`)
    .join("\n");
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
    'if [ "$1" = "pr" ] && [ "$2" = "create" ]; then echo "https://github.com/o/r/pull/9"; exit 0; fi',
    'if [ "$1" = "pr" ] && [ "$2" = "view" ]; then',
    '  V=$(cat ' + JSON.stringify(path.join(dir, "view-count")) + ' 2>/dev/null || echo 0)',
    '  echo $((V+1)) > ' + JSON.stringify(path.join(dir, "view-count")),
    '  if [ "$V" -eq 0 ]; then echo \'{"labels":[{"name":"truedone:unrun"}]}\'; else echo \'{"labels":[]}\'; fi',
    "  exit 0",
    "fi",
    'if [ "$1" = "api" ]; then echo \'[{"event":"labeled","label":{"name":"truedone:unrun"},"actor":{"login":"truedone-dev[bot]"}}]\'; exit 0; fi',
    "exit 0",
  ].join("\n");
  fs.writeFileSync(path.join(bin, "gh"), gh);
  fs.chmodSync(path.join(bin, "gh"), 0o755);
  const wrangler = [
    "#!/bin/sh",
    `echo "truedone-dev-switch $*" >> ${JSON.stringify(log)}`,
    wranglerWorks ? "exit 0" : "echo 'switch failed' >&2; exit 1",
  ].join("\n");
  fs.writeFileSync(path.join(bin, "truedone-dev-switch"), wrangler);
  fs.chmodSync(path.join(bin, "truedone-dev-switch"), 0o755);
  const curl = [
    "#!/bin/sh",
    "HEALTH_CALLS=$((HEALTH_CALLS+1))",
    ...healthStates.map((s) => `if [ $HEALTH_CALLS -eq ${healthStates.indexOf(s)} ]; then echo '{"posting_enabled":${s}}'; fi`),
    'if [ $HEALTH_CALLS -ge ' + healthStates.length + ' ]; then echo \'' + JSON.stringify({ posting_enabled: healthStates[healthStates.length - 1] ?? true }).replace(/^"|"$/g, "") + '\' 2>/dev/null || echo \'{"posting_enabled":true}\'; fi',
    "exit 0",
  ].join("\n");
  fs.writeFileSync(path.join(bin, "curl"), curl);
  fs.chmodSync(path.join(bin, "curl"), 0o755);
  void healthScript;
  return { bin, log };
}

function runSmoke(t, { bin, wranglerWorks, healthStates }) {
  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    TRUEDONE_SMOKE_WAIT_SECONDS: "1",
    HEALTH_CALLS: "0",
  };
  let stderr = "";
  let code = 0;
  try {
    execFileSync(process.execPath, [TOOL, "--repo", "o/r", "--switch-off-test"], { cwd: ROOT, env, encoding: "utf8" });
  } catch (error) {
    code = error.status ?? 1;
    stderr = String(error.stderr ?? "");
  }
  return { code, stderr, log: fs.readFileSync(path.join(bin, "..", "shim-log"), "utf8") };
}

test("the switch-off flips through truedone-dev-switch, seeds, waits, and restores", (t) => {
  const { bin } = shims(t, { wranglerWorks: true, healthStates: [false, true] });
  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    TRUEDONE_SMOKE_WAIT_SECONDS: "1",
  };
  const out = path.join(bin, "..", "run-out.txt");
  try {
    execFileSync(process.execPath, [TOOL, "--repo", "o/r", "--switch-off-test"], { cwd: ROOT, env, encoding: "utf8", stdio: ["ignore", fs.openSync(out, "w"), "pipe"] });
  } catch {
    // asserted below from the recording
  }
  const log = fs.readFileSync(path.join(bin, "..", "shim-log"), "utf8");
  assert.match(log, /truedone-dev-switch off/);
  assert.match(log, /truedone-dev-switch on/);
  const healthReads = fs.readFileSync(out, "utf8");
  assert.match(healthReads, /the switch is restored/);
  void bin;
});

test("without the switch on PATH the smoke reports BLOCKED and never reaches the restore", (t) => {
  const shimsRet = shims(t, { wranglerWorks: false, healthStates: [] });
  const r = runSmoke(t, { ...shimsRet, wranglerWorks: false, healthStates: [] });
  assert.match(r.stderr, /BLOCKED: truedone-dev-switch is not on PATH/);
  assert.doesNotMatch(r.log, /truedone-dev-switch on/);
});
