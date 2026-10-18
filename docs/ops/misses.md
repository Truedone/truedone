# Wrong verdicts: how a report becomes a benchmark case

Decision D39 in [docs/spec.md](../spec.md). Every verdict someone finds wrong is collected with enough data to reproduce it, and
a confirmed one becomes a case in the detection benchmark (BENCH-01), so the same mistake is checked on every change from then on.

## The report

Anyone files the form [Wrong verdict](../../.github/ISSUE_TEMPLATE/wrong-verdict.yml) on Truedone/truedone, or follows the link
on a check run or a public pull request page, which fills it. The form asks for the pull request link, its head and base
commits, the verdict shown and its reason codes, what is wrong (a false alarm, a missed tamper, missed evidence, the wrong
class), the truedone version and an optional note. It never asks for code. Its field ids (pr, head, base, verdict, reasons,
kind, version, note) are the ones the page's, the command line's and the App's links fill. `npx truedone report <PR link>` prints the filled link and sends nothing.

## The snapshot

For a public pull request the lead runner runs:

```
node tools/misses/snapshot.mjs <issue number> --out <a checkout of Truedone/truedone-misses>
```

It refuses a report without both 40-hex commits, then reads the pull request at exactly those commits: the comparison's files
and patches, the base and head text of each changed file and of the test and runner configuration in the directories above
each changed test, the pull request's title, body and author, and the check runs on the head. It writes one directory,
`<issue>-<owner>-<repo>-<number>/`, with `case.json` and `base/` and `head/` trees. `case.json` records the report, its kind
as the expected outcome, and the verdict the current core gives at those commits.

The directory goes to the private repository Truedone/truedone-misses and nowhere else: the tool refuses an `--out` inside this
repository. Another project's code is never copied into this repository, whatever its licence. A report on a private
repository holds only what the reporter typed; we ask for nothing more.

## Confirming and fixing

A maintainer of truedone reads the snapshot and, when the report holds, adds the label `confirmed` to the issue. Then:

1. Write a minimal case under `tools/test/fixtures/detect/<nn>-<name>/` by hand: the smallest base and head trees, in our own
   words and code, that show the same mistake. Nothing from the snapshot is pasted.
2. Give its `case.json` the field `"issue": <number>`, the expected verdict truedone should have given, and the kind.
3. Fix the core until `node tools/bench/detect.mjs --check` passes with the new case, and commit both together.

The case stays in the benchmark, so CI fails any later change that brings the mistake back.

## The counts

`node tools/misses/tally.mjs --snapshot <metrics.json>` counts the reports since the form was added (2026-10-18), the confirmed
ones (label `confirmed`) and the fixed ones (a benchmark case names the issue), and the confirmed false alarms and misses. It
writes them into the metrics snapshot as figures, each with its window, its source and its sample size. The false alarm rate
stays under not yet measured: a count of reports is not a rate, which also needs the number of verdicts given.
