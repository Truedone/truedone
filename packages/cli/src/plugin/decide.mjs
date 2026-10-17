// The plugin table of docs/spec.md as one pure function (PLG-01, PV-P02, PV-P03, PV-P05). It blocks in exactly three
// cases: a changed test fails on a fresh head run; a test was weakened or disabled (Tampered); the agent's last
// message claims tests pass while the changed tests have not run since its last file edit. No red-green evidence and
// Test changes: review never block: each finding is shown to the user once. After MAX_BLOCKS blocks in a row with no
// change since the last one, it lets the agent stop and shows the finding to the user instead.
import { MAX_BLOCKS } from './limits.mjs';

const failing = (runs) => runs.filter((t) => t.runs.some((r) => r.status !== 'pass'));

// facts: { verdict, reasons, runs, runProblem, changedTests, claim, ranAfterEdit, fingerprint }
//   verdict, reasons  core.analyse's result for the working diff
//   runs              fresh head runs of the changed tests: [{ file, name, runs: [{ status }] }]
//   runProblem        core/run's problem for that run ({ reason, detail }) or null: shown once, never blocks
//   changedTests      how many test files the diff adds or changes: with none, there is nothing to have run (PV-P03)
//   claim             the last message says tests pass
//   ranAfterEdit      true or false from the transcript's tool-call order; null when the transcript cannot tell
//   fingerprint       a hash of the diff and the findings: a new value means something changed
// state: { blocks, fingerprint, shown: [] } kept between Stops of one session
export function decide(facts, state = { blocks: 0, fingerprint: null, shown: [] }) {
  const why = [];
  if (facts.verdict === 'tampered') why.push(`Tampered: ${facts.reasons.map((r) => `${r.file}${r.line ? `:${r.line}` : ''} ${r.message}`).slice(0, 3).join('; ') || 'a test was weakened or disabled'}`);
  const bad = failing(facts.runs);
  if (bad.length) why.push(`${bad.length} changed test${bad.length === 1 ? '' : 's'} fail${bad.length === 1 ? 's' : ''} on a fresh run: ${bad.slice(0, 5).map((t) => `${t.file} ${t.name}`).join('; ')}`);
  if (facts.changedTests > 0 && facts.claim && facts.ranAfterEdit === false) why.push('the last message says the tests pass, but the changed tests have not run since the last file edit');
  const same = state.fingerprint === facts.fingerprint;
  const next = { blocks: 0, fingerprint: facts.fingerprint, shown: [...(state.shown ?? [])] };
  if (why.length) {
    const blocks = same ? state.blocks + 1 : 1;
    if (blocks > MAX_BLOCKS) {
      return { block: false, message: `truedone stopped blocking after ${MAX_BLOCKS} blocks with no change: ${why.join('. ')}.`, state: { ...next, blocks } };
    }
    return { block: true, reason: `truedone: ${why.join('. ')}. Fix this, or say plainly in your reply that it is not fixed.`, state: { ...next, blocks } };
  }
  const notes = [];
  if (facts.verdict === 'no_evidence') notes.push('No red-green evidence: source changed and no changed test fails without the change');
  if (facts.runProblem) notes.push(`The changed tests could not run (${facts.runProblem.reason}): ${facts.runProblem.detail}`);
  if (facts.verdict === 'review') notes.push(`Test changes: review: ${facts.reasons.map((r) => `${r.file} ${r.message}`).slice(0, 3).join('; ')}`);
  const fresh = notes.filter((n) => !next.shown.includes(`${facts.fingerprint}:${n}`));
  next.shown.push(...fresh.map((n) => `${facts.fingerprint}:${n}`));
  return fresh.length ? { block: false, message: `truedone: ${fresh.join('. ')}.`, state: next } : { block: false, state: next };
}
