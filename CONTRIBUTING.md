# Contributing to truedone

truedone checks whether a pull request's tests prove its change, and we hold this repository to the same rule: a change
lands with a test that fails without it and passes with it.

## How work lands

The work is split into tasks in `proofline.json`, the signed contract (its signature is `proofline.json.sig`, checked
against `guard/owner.pub`). Each task has an id such as `CORE-01`, a scope that lists the files it may touch, and
acceptance criteria. Only the maintainer adds or changes a task, so a change that no task covers starts as an issue (see
"Opening an issue" below).

A pull request:

- carries one task, and its title starts with the task id, for example `CORE-01: analyse() reads the diff`;
- touches only the files in that task's scope, and adds any new file to a node in `docs/DEPENDENCY-MAP.md` in the same
  change;
- comes with a test that fails before the change and passes after it; the pull request template asks for both outputs;
- passes the CI gate, the `truedone-gate` check. The gate takes the task id from the title and re-runs every criterion of
  that task from the signed contract on main, not from the copy in the pull request. Criteria listed under
  `ci.env_bound` in the contract need an account or a live service, and run after the merge.

A pull request merges only after the gate passes on it, and with a merge commit, so the task's commits stay on main. The
maintainer reads the tests a pull request adds before merging it.

A change never skips, focuses or deletes a test, removes an assertion, raises a timeout or lowers a threshold to make a
check pass. Test inputs that contain skip, focus, timeout or assertion text go in a `test/fixtures/` directory, never
inline in a `*.test.mjs` file. Workflows never use `pull_request_target`.

## Opening a pull request

1. Fork mgillr/truedone and create a branch from main.
2. Write the failing test first and keep its output.
3. Make the change, run the checks below, and commit with a sign-off (`git commit -s`).
4. Open the pull request against main, with the title starting with the task id, and fill in the template.

## Developer Certificate of Origin

Contributions are accepted under the Apache License 2.0 with the Developer Certificate of Origin (DCO), version 1.1:
https://developercertificate.org. Signing off a commit certifies the statements in the DCO for that commit.

Every commit carries a sign-off line with the name and email of the commit's author:

```
Signed-off-by: Your Name <you@example.com>
```

`git commit -s` adds it, and `git commit --amend -s --no-edit` adds it to the last commit. There is no contributor
licence agreement.

## Running the checks

The checks need:

- Node 22 or later.
- git, which the runner and gate tests drive.
- curl, which the stand-in browser in `packages/core/test/check-browser.test.mjs` calls.
- Python 3 with pytest (`python3 -m pip install pytest`), which `packages/core/test/run-live-pytest.test.mjs` runs.
- Chrome or Chromium, for the browser checks that `node tools/check-browser.mjs` runs. It is found through `CHROMIUM_BIN`,
  then `chromium`, `chromium-browser`, `google-chrome` or `google-chrome-stable` on PATH, then the standard install
  paths: on macOS `/Applications/Google Chrome.app` and `/Applications/Chromium.app`, on Linux `/usr/bin/google-chrome`
  and `/usr/bin/chromium`. For an install elsewhere, set `CHROMIUM_BIN=` to the browser's path, for example
  `CHROMIUM_BIN=/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`.

There are no dependencies, so `npm ci` installs nothing; `package-lock.json` is empty on purpose.

```
npm test
node tools/depmap-check.mjs
```

`npm test` runs every package's tests with `node:test`. `node tools/depmap-check.mjs` checks the dependency map in
`docs/DEPENDENCY-MAP.md`: every file belongs to a node, and a change to a node also changes each node it must update. It
compares the branch with origin/main plus the working tree, and prints the nodes to review. Both exit 0 on a change that
is ready.

## Zero dependencies

No package.json in the repository declares dependencies or devDependencies (decision D23 in `docs/spec.md`). Tests use
`node:test`, the single-file builds come from `tools/bundle.mjs`, browser checks use the system Chromium, and deploys run
wrangler through npx. Zero dependencies is part of what truedone claims, and a development dependency would add
supply-chain surface to the release path, so a change keeps both lists empty.

## Opening an issue

Open an issue at https://github.com/mgillr/truedone/issues/new/choose with one of the two forms:

- **Bug report**: where it happened, what you ran, what you expected, what happened, and the version.
- **Feature request**: the problem, the change you propose, and how a test would show it.

Blank issues are off, so every issue starts from a form. Search the open issues first, and if one matches, add to it.

Do not report a security vulnerability in a public issue. Follow the security policy at
https://github.com/mgillr/truedone/security/policy.

## Code of conduct

Everyone taking part follows the [code of conduct](CODE_OF_CONDUCT.md), the Contributor Covenant 2.1. Report
unacceptable behaviour to rgillespie83@icloud.com.
