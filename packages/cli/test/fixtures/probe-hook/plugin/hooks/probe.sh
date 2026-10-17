#!/bin/sh
# Stop hook probe for docs/plugin-hooks.md (PLG-00). It records what Claude Code hands a Stop hook (the input JSON,
# the plugin variables, and the transcript file as it stands at that moment), then answers as PROBE_MODE says.
# It writes only under PROBE_OUT, and it never runs node, so a probe run needs no QUIET window.
set -u
out=${PROBE_OUT:?PROBE_OUT is not set}
mkdir -p "$out"
n=$(( $(cat "$out/count" 2>/dev/null || echo 0) + 1 ))
echo "$n" > "$out/count"
date +%s > "$out/start-$n.txt"
cat > "$out/stop-$n.json"
env | grep -E '^CLAUDE_(PLUGIN_ROOT|PLUGIN_DATA|PROJECT_DIR)=' > "$out/env-$n.txt"
# Copy the transcript before answering: the copy is what a hook could read when Stop fired
python3 -I - "$out/stop-$n.json" "$out/transcript-$n.jsonl" <<'PY'
import json, shutil, sys
s = json.load(open(sys.argv[1]))
shutil.copyfile(s["transcript_path"], sys.argv[2])
PY
case "${PROBE_MODE:-log}" in
  log) exit 0 ;;
  message) printf '{"systemMessage":"truedone probe: user-visible message %s"}\n' "$n"; exit 0 ;;
  exit2)
    if [ "$n" -eq 1 ]; then echo "truedone probe: blocked by exit 2. Reply with the single word AGAIN." >&2; exit 2; fi
    exit 0 ;;
  json)
    if [ "$n" -eq 1 ]; then printf '{"decision":"block","reason":"truedone probe: blocked by JSON. Reply with the single word AGAIN."}\n'; fi
    exit 0 ;;
  always) printf '{"decision":"block","reason":"truedone probe: block %s. Reply with the single word AGAIN."}\n' "$n"; exit 0 ;;
  sleep)
    sleep "${PROBE_SLEEP:?PROBE_SLEEP is not set}"
    printf '{"decision":"block","reason":"truedone probe: this block arrives after the timeout. Reply with the single word LATE."}\n'
    exit 0 ;;
  *) echo "probe.sh: unknown PROBE_MODE ${PROBE_MODE}" >&2; exit 1 ;;
esac
