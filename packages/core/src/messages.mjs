export const tampered = 'A test that existed at base was disabled, focused or weakened.';
export const review = 'A test change in {name} needs a look.';
export const unrun = 'Tests in {name} changed and have not been run.';
export const no_evidence = 'No red-green evidence for {name}.';
export const not_applicable = 'Not applicable for {name}.';
export const language = 'language not supported in version 1';
export const skip_focus = 'A skip or focus marker is in {name}.';
export const partial = 'Only part of the change was analysed.';
export const bot = 'A listed bot opened {name}.';
export const skip = 'Test {name} is skipped on head.';
export const focus = 'Test {name} is focused on head.';
export const weakened = 'Test {name} has a weaker assertion on head.';
export const deleted = 'Test {name} was removed.';
export const snapshot = 'Snapshot {name} changed.';
export const parametrised = 'A parametrised case was removed in {name}.';
export const timeout = 'The timeout of {name} was raised.';
export const runner_config = 'Runner config {name} changed.';
export const step_release = 'The truedone step in {name} moved to a published release.';
export const step = 'The truedone step in {name} was removed or edited.';
export const claim = 'The text claims tests were added.';
export const no_test = 'Source file {name} changed with no test change.';

// What to do next, per verdict (docs/spec.md, the verdict table)
export const NEXT = {
  tampered: 'Restore an equivalent test, or pin the step to a published release.',
  review: 'Confirm the test change is intended.',
  could_not_run: 'Fix the named reason and run again.',
  proven: 'Review the rest of the change as usual.',
  proven_new: 'Review the rest of the change as usual.',
  proven_weak: 'Make the test run the changed lines and assert on them.',
  no_evidence: 'Add a test that fails before the change and passes after it.',
  pending: 'Approve the run on GitHub.',
  unrun: 'Run the changed tests: the next rung.',
  not_applicable: 'Nothing.',
};

// result.next (CORE-09): built from the reasons that give the result's verdict, one sentence per group of them, in this
// order. A test or step group says restore or pin under Tampered and asks to confirm the change under Test changes:
// review. A lesser finding keeps its reason line but adds nothing here: acting on it would not change the verdict. A
// verdict whose reasons fall in no group keeps its sentence above.
const GROUPS = [
  [['skip', 'focus', 'weakened', 'deleted', 'parametrised', 'timeout', 'snapshot'], 'Restore an equivalent test.', 'Confirm the test change is intended.'],
  [['step', 'step_release'], 'Pin the truedone step to a published release.', 'Confirm the step change is intended.'],
  [['runner_config'], null, 'Confirm the runner config change is intended.'],
  [['unrun'], null, 'Run the changed tests: the next rung.'],
];

export function nextStep(verdict, reasons) {
  // a reason without its own verdict counts as the result's
  const giving = (reasons || []).filter((r) => (r.verdict ?? verdict) === verdict);
  const out = [];
  for (const [checks, ifTampered, otherwise] of GROUPS) {
    if (!giving.some((r) => checks.includes(r.check))) continue;
    out.push(verdict === 'tampered' && ifTampered ? ifTampered : otherwise);
  }
  return out.length ? out.join(' ') : NEXT[verdict] || '';
}
