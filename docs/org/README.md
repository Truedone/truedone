# Truedone

Truedone shows whether a pull request's tests prove its change: red without it, green with it, and nothing weakened on the way.

Try it on any public pull request: open truedone.pages.dev/owner/repo/pull/n. Nothing to install.

## What we measure

Each figure carries the window it covers, the source it was read from and the sample it rests on. A metric with no honest source yet says so, with the reason.

| Metric | Figure | Window | Source | Sample |
|---|---|---|---|---|
| Repositories integrated | Not yet measured | | needs installation records from the App, or an opt-in usage count; stars and forks are not adoption | |
| Active in 30 days | Not yet measured | | needs the same records, over a 30 day window | |
| Pull requests checked | Not yet measured | | needs a count of verdicts from the App, the action and the command line | |
| Faults caught beyond CI | Not yet measured | | needs the labelled detection benchmark (BENCH-01) and reviewed real cases | |
| False alarm rate | Not yet measured | | needs the labelled benchmark and the review gates (GATE-02, GATE-03R) | |
| Verification success rate | Not yet measured | | needs the count of verdicts that completed against those that did not | |
| 30-day retention | Not yet measured | | needs installation records over two windows | |
| Weekly growth | Not yet measured | | needs two weekly snapshots on the metrics-data branch | |

## Measured today

Public GitHub data for this organisation, read 2026-10-18. Visibility and activity, not adoption.

| Metric | Figure | Window | Source | Sample |
|---|---|---|---|---|
| Public repositories | 5 | on 2026-10-18 | [api.github.com/orgs/Truedone/repos](https://api.github.com/orgs/Truedone/repos?type=public&per_page=100) | 5 |
| Open issues | 7 | on 2026-10-18 | [api.github.com/repos/Truedone/truedone/issues](https://api.github.com/repos/Truedone/truedone/issues?state=all&per_page=100&sort=created&direction=desc) and 4 more | 5 |
| Pull requests opened | 157 | 2026-09-18 to 2026-10-18 | [api.github.com/repos/Truedone/truedone/issues](https://api.github.com/repos/Truedone/truedone/issues?state=all&per_page=100&sort=created&direction=desc) and 4 more | 5 |
| Hours to a first issue response, median | 0.61 h | 2026-09-18 to 2026-10-18 | [api.github.com/repos/Truedone/truedone/issues/125/comments](https://api.github.com/repos/Truedone/truedone/issues/125/comments?per_page=1) and 9 more | 10 |
| Wrong-verdict reports | 0 | 2026-10-18 to 2026-10-19 | [api.github.com/repos/Truedone/truedone/issues](https://api.github.com/repos/Truedone/truedone/issues?labels=wrong-verdict&state=all&per_page=100) | 0 |
| Confirmed wrong verdicts | 0 | 2026-10-18 to 2026-10-19 | [api.github.com/repos/Truedone/truedone/issues](https://api.github.com/repos/Truedone/truedone/issues?labels=wrong-verdict&state=all&per_page=100) | 0 |
| Fixed wrong verdicts | 0 | 2026-10-18 to 2026-10-19 | [api.github.com/repos/Truedone/truedone/issues](https://api.github.com/repos/Truedone/truedone/issues?labels=wrong-verdict&state=all&per_page=100) and 1 more | 0 |

Definitions and limits: [docs/ops/metrics.md](https://github.com/Truedone/truedone/blob/main/docs/ops/metrics.md). Source: [Truedone/truedone](https://github.com/Truedone/truedone).
