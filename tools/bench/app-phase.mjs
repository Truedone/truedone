// APP-06-AC13: the App's own time to the label, from a wrangler tail converted
// by tail-fields (one JSON line per event: {ts, kind, colo, outcome, wallMs,
// cpuMs, logs}). The static stage's phase line is a log entry that parses as
// JSON with stage "static"; the App's label time is phase1_ms + label_ms — the
// switch and the label chain, from the delivery's arrival (D37). Prints {n,
// p50_app_label_ms, p95_app_label_ms, version, source}; exits 1 on an empty
// tail, so an instrumented run that saw nothing fails.
import fs from "node:fs";

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
const version = args.includes("--version") ? args[args.indexOf("--version") + 1] : "unversioned";
if (!file) {
  console.error("usage: node tools/bench/app-phase.mjs <tail.jsonl> [--version <sha>]");
  process.exit(2);
}
const lines = fs.readFileSync(file, "utf8").split("\n").filter(Boolean);
const appLabel = [];
for (const line of lines) {
  let event;
  try { event = JSON.parse(line); } catch { continue; }
  for (const log of event.logs ?? []) {
    let phase;
    try { phase = JSON.parse(log); } catch { continue; }
    if (phase.stage === "static" && typeof phase.phase1_ms === "number" && typeof phase.label_ms === "number") {
      appLabel.push(phase.phase1_ms + phase.label_ms);
    }
  }
}
appLabel.sort((a, b) => a - b);
const n = appLabel.length;
// p50 interpolates the middle pair; p95 is nearest-rank, so the tail is never
// smoothed away.
const mid = (q) => {
  const pos = q * (n - 1);
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return appLabel[lo] + (appLabel[hi] - appLabel[lo]) * (pos - lo);
};
const nearest = (q) => appLabel[Math.min(n - 1, Math.max(0, Math.ceil(n * q) - 1))];
console.log(JSON.stringify({ n, p50_app_label_ms: n ? mid(0.5) : null, p95_app_label_ms: n ? nearest(0.95) : null, version, source: file }));
if (n === 0) process.exit(1);
