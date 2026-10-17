// The truedone Stop hook (PLG-01, PV-P01). tools/bundle.mjs builds packages/cli/plugin/hooks/stop.mjs from this file,
// with core and core/run inlined and the line const REDGREEN_ENABLED = false; (PLG-03 turns it on). It reads the Stop
// input (docs/plugin-hooks.md), analyses the working diff against the merge-base with the default branch, runs the
// changed tests once on head, and answers by the plugin table (decide.mjs). It always exits 0 and blocks only through
// {"decision": "block"}, so a crash never blocks; findings that do not block go to the user in systemMessage. State is
// one small file per session under ${CLAUDE_PLUGIN_DATA}. It makes no network call.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { decide } from './decide.mjs';
import { claimsTestsPass, toolCalls, ranTestsAfterLastEdit, holdsFinalMessage } from './transcript.mjs';

// docs/plugin-hooks.md, "Probe": on Claude Code 2.1.302 the transcript holds the turn's last tool call when Stop
// fires. The reference warns it may lag on other versions, so each Stop also checks that the transcript already holds
// last_assistant_message; when it does not, its order cannot prove that no test ran, and case 3 does not block on it.
export const TRANSCRIPT_CURRENT = true;

const RUN_TIMEOUT_MS = 120000;

// deps: { analyse, classify, localInput(root, { classify }) -> { input, base }, detect(root, paths),
//   runSide(opts) -> { tests, problem, runner } as core/run returns it, dataDir }
export async function hook(stdin, deps) {
  const s = JSON.parse(stdin);
  const root = s.cwd;
  const { input } = deps.localInput(root, { classify: deps.classify });
  if (!input.files.length) return null;
  const result = deps.analyse(input);
  const tests = input.files.filter((f) => f.status !== 'removed' && deps.classify(f.path) === 'test').map((f) => f.path);
  const detected = tests.length ? deps.detect(root, tests).filter((d) => d.runner) : [];
  const side = detected.length ? await deps.runSide({ root, tests: detected, side: 'head', times: 1, timeoutMs: RUN_TIMEOUT_MS }) : null;
  const runs = side?.tests ?? [];
  let transcript = '';
  try { transcript = fs.readFileSync(s.transcript_path, 'utf8'); } catch { /* no transcript: case 3 cannot be judged */ }
  const ran = transcript ? ranTestsAfterLastEdit(toolCalls(transcript)) : null;
  const facts = {
    verdict: result.verdict,
    reasons: result.reasons ?? [],
    runs,
    runProblem: side?.problem ?? null,
    changedTests: tests.length,
    claim: claimsTestsPass(s.last_assistant_message),
    ranAfterEdit: (deps.transcriptCurrent ?? TRANSCRIPT_CURRENT) && holdsFinalMessage(transcript, s.last_assistant_message) ? ran : null,
    fingerprint: createHash('sha256').update(JSON.stringify([input.files.map((f) => [f.path, f.status, f.patch ?? '']), result.verdict, runs])).digest('hex').slice(0, 16),
  };
  const file = path.join(deps.dataDir, 'sessions', `${String(s.session_id).replace(/[^A-Za-z0-9_-]/g, '_')}.json`);
  let state;
  try { state = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { state = undefined; }
  const d = decide(facts, state);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  d.state.shown = d.state.shown.slice(-50);
  fs.writeFileSync(file, JSON.stringify(d.state));
  if (d.block) return { decision: 'block', reason: d.reason };
  if (d.message) return { systemMessage: d.message };
  return null;
}

// The entry the bundle runs: stdin in, one JSON object or nothing out, exit 0
export async function main(deps, { stdin = process.stdin, stdout = process.stdout } = {}) {
  let text = '';
  for await (const c of stdin) text += c;
  let out;
  try { out = await hook(text, deps); } catch (e) { out = { systemMessage: `truedone could not check this turn: ${e?.message ?? e}` }; }
  if (out) stdout.write(JSON.stringify(out) + '\n');
}
