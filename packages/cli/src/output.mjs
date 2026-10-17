// What npx truedone prints (CLI-01). The readable form names the verdict, up to 10 reasons, what would change the
// verdict and the next rung; --json prints core's result as it came. The wording states what was observed and never
// addresses the PR's author.
export const SCHEMA = 'truedone.verdict/1';
export const VERDICTS = {
  tampered: 'Tampered',
  review: 'Test changes: review',
  could_not_run: 'Could not run',
  proven: 'Proven',
  proven_new: 'Proven (new behaviour)',
  proven_weak: 'Proven (weak)',
  no_evidence: 'No red-green evidence',
  pending: 'Waiting for approval',
  unrun: 'Tests changed: not run',
  not_applicable: 'Not applicable',
};
export const MAX_REASONS = 10;

export function readable(result, what) {
  const lines = [`truedone: ${VERDICTS[result.verdict] ?? result.verdict}${result.partial ? ' (partial)' : ''}`, `  ${what}`];
  if (result.label) lines.push(`  label ${result.label}`);
  const reasons = result.reasons ?? [];
  for (const r of reasons.slice(0, MAX_REASONS)) lines.push(`  - ${r.file}${r.line ? `:${r.line}` : ''}: ${r.message}`);
  if (reasons.length > MAX_REASONS) lines.push(`  ${reasons.length - MAX_REASONS} more not shown (--json lists them all)`);
  if (result.next) lines.push(`What would change the verdict: ${result.next}`);
  lines.push(
    '',
    'Next rung: the truedone Claude Code plugin runs these checks on an agent\'s change before the agent reports the task done.',
    'Red-green runs the change\'s own tests against base and head with --run, which this version does not have yet. On someone else\'s PR, red-green executes that PR\'s code on the machine that runs it.',
  );
  return lines.join('\n') + '\n';
}
