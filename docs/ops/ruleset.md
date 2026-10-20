# Rulesets on main

Two rulesets on Truedone/truedone, active on the default branch. GitHub reports these rules on main: non_fast_forward, deletion, pull_request, required_status_checks.

- `main-history` blocks force pushes and deletion of main. It has no bypass, so it holds for my own account too.
- `main-review` requires a pull request and the status check `truedone-gate`, the GitHub Actions job in `.github/workflows/ci.yml`, pinned to the GitHub Actions app (integration id 15368), so a status of that name from any other source does not count. There is no required approval: the lead runner opens every pull request with my login, and GitHub does not let an author approve their own (D25). Repository admins may bypass this ruleset, so my own signed contract and ops commits still reach main. It therefore does not stop my account from merging; the lead runner merges a pull request only after its gate passed.
- From 2026-10-17 (D22), while a billing lock stopped GitHub Actions on my account, the lead runner ran the CI job in an isolated container and posted `truedone-gate (lead runner, docker)`. Actions run again, and on 2026-10-20 I switched the required check to `truedone-gate` and pinned it to the GitHub Actions app.

Repository settings: merge commits true, squash false, rebase false, delete branch on merge true.

Read back on 2026-10-17, before the move, and again on 2026-10-18 after the move to the Truedone organisation (D36), with
`gh api repos/Truedone/truedone/rules/branches/main`, `gh api repos/Truedone/truedone/rulesets/<id>` and `gh api repos/Truedone/truedone`.
The move kept both rulesets' rules but dropped main-review's bypass for repository admins, which I added again.
