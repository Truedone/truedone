# Rulesets on main

Two rulesets on Truedone/truedone, active on the default branch. GitHub reports these rules on main: non_fast_forward, deletion, pull_request, required_status_checks.

- `main-history` blocks force pushes and deletion of main. It has no bypass, so it holds for my own account too.
- `main-review` requires a pull request and the status check `truedone-gate (lead runner, docker)`. There is no required approval: the lead runner opens every pull request with my login, and GitHub does not let an author approve their own (D25). Repository admins may bypass this ruleset, so my own signed contract and ops commits still reach main. It therefore does not stop my account from merging; the lead runner merges a pull request only after its gate passed.
- GitHub Actions do not run on my account while a billing lock lasts (from 2026-10-17, D22), so the lead runner runs the CI job in an isolated container and posts that status. When Actions run again, the required check becomes `truedone-gate`.

Repository settings: merge commits true, squash false, rebase false, delete branch on merge true.

Read back on 2026-10-17 with `gh api repos/Truedone/truedone/rules/branches/main` and `gh api repos/Truedone/truedone`.
