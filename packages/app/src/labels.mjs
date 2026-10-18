// The truedone labels (spec, Labels): exactly one truedone:* label on a PR at any time.
// Created on first use, fixed colors, descriptions under GitHub's 100-character
// limit, each ending in truedone.pages.dev/why.

export const LABELS = [
  { name: "truedone:tampered", color: "b60205", description: "A test that existed at base was disabled or weakened. Why: truedone.pages.dev/why" },
  { name: "truedone:review", color: "d93f0b", description: "Tests or runner setup changed in a way to review. Why: truedone.pages.dev/why" },
  { name: "truedone:could-not-run", color: "e99695", description: "No test reached a result; the reason is in the check run. Why: truedone.pages.dev/why" },
  { name: "truedone:yes", color: "0e8a16", description: "A test in this PR fails without the change and passes with it. Why: truedone.pages.dev/why" },
  { name: "truedone:weak", color: "c2e0c6", description: "Red-green holds, but no changed line is run or asserted. Why: truedone.pages.dev/why" },
  { name: "truedone:no-evidence", color: "fef2c0", description: "Source changed, and no test in the PR fails without it. Why: truedone.pages.dev/why" },
  { name: "truedone:pending", color: "d4c5f9", description: "GitHub is holding the run for a first-time contributor. Why: truedone.pages.dev/why" },
  { name: "truedone:unrun", color: "bfd4f2", description: "Tests changed cleanly and no red-green has run yet. Why: truedone.pages.dev/why" },
];

// Verdict (truedone.verdict/1) -> label name; Not applicable maps to none.
export const VERDICT_LABEL = {
  tampered: "truedone:tampered",
  review: "truedone:review",
  could_not_run: "truedone:could-not-run",
  proven: "truedone:yes",
  proven_new: "truedone:yes",
  proven_weak: "truedone:weak",
  no_evidence: "truedone:no-evidence",
  pending: "truedone:pending",
  unrun: "truedone:unrun",
  not_applicable: null,
};

// GitHub's label description field is capped at 100 characters.
for (const l of LABELS) {
  if (l.description.length > 100) throw new Error(`label description over 100: ${l.name}`);
}
