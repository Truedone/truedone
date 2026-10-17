#!/bin/sh
# run-probe.sh <mode> <out-dir> [timeout-seconds] [sleep-seconds]: one headless Claude Code turn with the probe plugin
# loaded, for docs/plugin-hooks.md (PLG-00). The turn runs one marked Bash command and then answers.
# - The child gets a clean environment (env -i), so it is a top-level session, not one nested in the caller's.
# - --setting-sources project loads no user settings, so the user's own hooks and plugins do not run.
# - --strict-mcp-config with no config loads no MCP servers.
# - A copy of the plugin goes into the out directory; when a timeout is given, the copy's hooks.json carries it.
# It prints the stream-json output to <out-dir>/stream.jsonl and the probe's records to <out-dir>/probe/.
set -eu
mode=$1; out=$2; timeout=${3:-}; sleep_s=${4:-}
here=$(cd "$(dirname "$0")" && pwd)
mkdir -p "$out/project" "$out/probe"
rm -rf "$out/plugin"; cp -R "$here/plugin" "$out/plugin"
if [ -n "$timeout" ]; then
  python3 -I - "$out/plugin/hooks/hooks.json" "$timeout" <<'PY'
import json, sys
f, t = sys.argv[1], int(sys.argv[2])
j = json.load(open(f))
j["hooks"]["Stop"][0]["hooks"][0]["timeout"] = t
open(f, "w").write(json.dumps(j, indent=2) + "\n")
PY
fi
nonce=$(python3 -I -c 'import secrets; print(secrets.token_hex(4))')
echo "$nonce" > "$out/nonce.txt"
prompt="Use the Bash tool once to run exactly this command: echo PROBE_$nonce
After it returns, reply with exactly: DONE $nonce
If you are asked to continue, reply with the single word you are asked for, and run no tool."
cd "$out/project"
date +%s > "$out/t0.txt"
set +e
env -i HOME="$HOME" USER="$USER" LOGNAME="${LOGNAME:-$USER}" TERM=dumb LANG=en_US.UTF-8 \
  PATH="$HOME/.local/bin:/usr/bin:/bin:/usr/sbin:/sbin" \
  PROBE_MODE="$mode" PROBE_OUT="$out/probe" PROBE_SLEEP="$sleep_s" \
  claude -p "$prompt" --model haiku --output-format stream-json --verbose \
    --setting-sources project --strict-mcp-config --plugin-dir "$out/plugin" \
    --allowedTools "Bash(echo PROBE_$nonce)" \
  > "$out/stream.jsonl" 2> "$out/stderr.txt"
echo $? > "$out/exit.txt"
date +%s > "$out/t1.txt"
claude --version > "$out/version.txt" 2>&1
