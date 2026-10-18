# Public metrics

The organisation's public GitHub signals are collected once a day by `.github/workflows/metrics.yml` into one JSON
snapshot (`tools/metrics/collect.mjs`, MET-01), checked by `tools/metrics/check.mjs`, and written to the `metrics-data`
branch as `metrics/latest.json` with one file a day under `metrics/history/`. Main never takes the snapshot; the seed
committed at `docs/metrics/latest.json` is the one the organisation profile is generated from until the workflow feeds it.
The collector reads without a token (60 requests an hour, about 40 used) and takes the workflow's token when it has one.

Every figure carries three things, and the checker refuses one that lacks any: the window it covers (a from and to, or a
point in time), the URL it was read from, and the sample size it rests on. A metric with no honest public source is
listed under `not_yet_measured` with the reason, and is never shown as a zero.

## The figures

| Figure | Definition | Window | What it is not |
|---|---|---|---|
| `public_repositories` | Public, unarchived repositories of the organisation | now | Not adoption |
| `stars_total`, `forks_total` | Their stargazer and fork counts summed | now | Visibility, not use |
| `repositories_pushed_in_window` | Repositories with a push inside the window | 30 days | The organisation's own activity |
| `releases_in_window` | Releases published inside the window, all repositories | 30 days | |
| `workflow_runs_in_window`, `_success`, `_failure`, `_cancelled` | Completed GitHub Actions runs created inside the window, by conclusion, every repository | 30 days | This organisation's CI, not a user's; it includes the sandbox, whose runs fail by design, so the rate is not a health figure and stays off the profile |
| `workflow_success_rate` | Successful completed runs over all completed runs; `n` is the run count | 30 days | |
| `open_issues`, `open_pull_requests` | Open at the time of the read | now | |
| `issues_opened_in_window`, `pull_requests_opened_in_window` | Opened inside the window | 30 days | |
| `median_hours_to_first_issue_response` | Median hours from an issue's opening to its first comment, over the most recent commented issues of the window, at most 10 a repository; `n` is the sample | 30 days | A comment is not a resolution |

## Not yet measured

`repositories_running_truedone`, `active_integrations_30d`, `pull_requests_checked`, `faults_caught_beyond_ci`,
`false_alarm_rate`, `verification_success_rate`, `retention_30d` and `weekly_growth` have no public source before the
first release. Installation and verdict counts come from the App, the action and the command line once they are live;
the fault and false alarm figures come from the labelled detection benchmark (BENCH-01) and the review gates; growth
needs two weekly snapshots on the `metrics-data` branch. Each gets a figure when its source exists, and leaves this list.

## The organisation profile

`tools/org-profile.mjs <snapshot> <page>` writes the profile page `docs/org/README.md` from a snapshot (ORG-02): a
name, one sentence of value, one line on trying it, a table of eight headline metrics with figure, window, source and
sample size, the words Not yet measured where the snapshot has no source, and a second table of the public figures the
snapshot does carry. At most 60 lines, no figure without a source, none of the marketing words the generator refuses, no
em or en dashes. `--check <snapshot> <page>` exits 1 when the page breaks a rule or differs from what the generator
writes. Ryan creates the repository `Truedone/.github` once and pushes the page to `profile/README.md`; the metrics
workflow refreshes it from the daily snapshot once the release plumbing (OPS-07) gives it a token.
