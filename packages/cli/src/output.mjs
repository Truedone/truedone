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
    'Red-green runs the change\'s own tests against base and head: add --run. On someone else\'s PR, red-green executes that PR\'s code on the machine that runs it; --docker runs it in a container.',
  );
  return lines.join('\n') + '\n';
}

// D38: --pr-line prints one line for a pull request description, the verdict, its reason in one sentence and the link to
// the verdict's public page, so the verdict travels with the agent's work to the maintainer who reads the pull request.
// The sentences are the labels' own (packages/app/src/labels.mjs), for the verdicts that have no label the spec's rule.
export const SITE = 'https://truedone.pages.dev';
export const REASON = {
  tampered: 'a test that existed at base was disabled or weakened',
  review: 'tests or runner setup changed in a way to review',
  could_not_run: 'no test reached a result',
  proven: 'a test in this pull request fails without the change and passes with it',
  proven_new: 'a test fails at base only for want of what the change adds, and passes with it',
  proven_weak: 'red-green holds, but no changed line is run or asserted',
  no_evidence: 'source changed, and no test in the pull request fails without it',
  pending: 'GitHub is holding the run for a first-time contributor',
  unrun: 'tests changed cleanly and no red-green has run yet',
  not_applicable: 'the change is docs, a lockfile, a listed bot or a rename, which truedone does not judge',
};
// The verdict's public page: the pull request's page, or the why page when no pull request exists yet
export const pageLink = (target) => (target ? `${SITE}/${target.owner}/${target.repo}/pull/${target.number}?via=pr-line` : `${SITE}/why?via=pr-line`);
export function prLine(result, target) {
  return `truedone: ${VERDICTS[result.verdict] ?? result.verdict}${result.partial ? ' (partial)' : ''}, ${REASON[result.verdict] ?? 'see the page'}. ${pageLink(target)}`;
}

// Prints a result, as --json, --pr-line or readable, and returns the exit code: 1 when --fail-on names the verdict, else 0
export function emit(result, what, { json, failOn, prLine: line = false, target = null }, stdout) {
  if (result?.schema !== SCHEMA) throw new Error(`core returned no ${SCHEMA} result`);
  stdout.write(line ? `${prLine(result, target)}\n` : json ? `${JSON.stringify(result)}\n` : readable(result, what));
  return failOn?.has(result.verdict) ? 1 : 0;
}
