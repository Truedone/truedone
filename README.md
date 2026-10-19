# truedone

truedone checks whether a pull request's tests prove its change: red without the change, green with it. It also flags tests that were skipped, focused or weakened. Each pull request gets one verdict, so a reviewer sees what the tests show before reading the diff. This matters most when a coding agent opened the pull request.

## Why it exists

- A green CI run says the tests pass. It does not say they fail without the change. A test that passes on the base branch and on the pull request proves nothing about the change.
- A failing test can be silenced by skipping it (`it.skip`, `@pytest.mark.skip`), by focusing another test (`.only`), or by weakening its assertion (`toBe(3)` changed to `toBeDefined()`). In a large diff these lines are easy to miss.
- Maintainers describe a flood of pull requests from coding agents. truedone gives each one a verdict and a label (none for Not applicable), so a maintainer can filter the pull request list without reading anything.

## How it works

truedone sorts each changed file into a class, then runs its checks on each test, matched by name. These static checks run no code. The next rung is the red-green run: each changed test runs twice on the base, without the change, and three times on the head, with it.

```mermaid
flowchart TD
  PR["Pull request"] --> CL["Classify each changed file<br/>test, setup, runner config, workflow, docs, source, ..."]
  CL --> ST["Static checks, per test, matched by name"]
  ST --> Q1{"A test that existed at base disabled,<br/>focused or weakened, or the truedone step edited?"}
  Q1 -->|yes| TA["Tampered"]
  Q1 -->|no| Q2{"Snapshot, parametrised case, timeout,<br/>runner config, setup file or workflow changed?"}
  Q2 -->|yes| RV["Test changes: review"]
  Q2 -->|no| Q3{"What changed?"}
  Q3 -->|"source, no test"| NE["No red-green evidence"]
  Q3 -->|"docs, lockfile, listed bot, rename"| NA["Not applicable"]
  Q3 -->|tests| UN["Tests changed: not run"]
  UN --> RG["Next rung: red-green run<br/>base twice, head three times"]
  RG -->|"red on base, green on head"| PV["Proven, Proven (new behaviour)<br/>or Proven (weak)"]
  RG -->|"green on base, or red on head"| NE
  RG -->|"flaky, errored or timed out"| CN["Could not run, with the reason"]
```

Every pull request gets exactly one verdict. The first that applies in this table wins. When several tests ran, the best result of any test stands and the others are listed. A verdict states what was observed about the change.

| Verdict | Label | What it means | What to do next |
|---|---|---|---|
| Tampered | `truedone:tampered` | A test that existed at base is disabled, focused or weakened with nothing equivalent added, or the truedone step was removed, edited or re-pinned other than to a published release. | Restore an equivalent test, or pin the step to a published release. |
| Test changes: review | `truedone:review` | Tests moved, removed or rewritten in a way that may be legitimate, a raised timeout, or a change to the runner config, a setup file, the test script or the truedone workflow. | Confirm the test change is intended. |
| Could not run | `truedone:could-not-run` | No test reached a result. The reason is named: a missing runner, service or setup step, flaky results, an error or a timeout. | Fix the named reason and run again. |
| Proven | `truedone:yes` | A test fails on base by assertion twice, passes on head three times out of three, and runs lines the pull request changed. | Review the rest of the change as usual. |
| Proven (new behaviour) | `truedone:yes` | A test fails on base only because a function or module the pull request adds does not exist yet, passes on head three times out of three, asserts on the new code's result, and runs lines the pull request changed. | Review the rest of the change as usual. |
| Proven (weak) | `truedone:weak` | Red-green holds, but the test runs none of the changed non-test lines or asserts nothing about them. | Make the test run the changed lines and assert on them. |
| No red-green evidence | `truedone:no-evidence` | Source changed, and no test in the pull request fails without the change. | Add a test that fails before the change and passes after it. |
| Waiting for approval | `truedone:pending` | Tests changed and the repository has the truedone step, but GitHub is holding the run for a first-time contributor. The static findings are shown meanwhile. | Approve the run on GitHub. |
| Tests changed: not run | `truedone:unrun` | Tests were added or changed with nothing weakened, and no red-green run has happened. | Run the changed tests: the next rung. |
| Not applicable | none | Docs only, a lockfile or dependency change, a dependency or release bot, a CI-only change that touches no test and not the truedone step, a pure rename, or a language version 1 does not support. | Nothing. |

A large pull request that was only partly analysed gets "(partial)" after its verdict. The check conclusion is neutral by default, so truedone never blocks a merge unless the repository sets `conclusion: fail-on-tampered` in `.github/truedone.yml`.

**Threat model.** truedone catches careless agents and lazy shortcuts. Whoever controls a pull request also controls the test code that runs in it. The static checks flag changes to runner config and setup files, but the pull request side is not a security boundary. A weakness in truedone itself goes to the [security policy](SECURITY.md).

**Privacy.** The site, the CLI and the plugin read from GitHub and keep nothing on a server. The app keeps one setting per installation and deletes it within 24 hours of an uninstall. Labels already set stay after uninstall. The [privacy note](docs/privacy.md) says what each part reads and stores, and for how long; the [terms](docs/terms.md) cover the hosted parts.

## Ways to use it

<!-- ways: written by node tools/readme-status.mjs from packages/web/lib/release.mjs; do not edit -->
The site is live: truedone.pages.dev checks any public pull request now. The command line, the plugin, the App and the action come with the first release, planned in [docs/spec.md](docs/spec.md), each after its release's gates pass.

| Surface | Who it is for | Status |
|---|---|---|
| [truedone.pages.dev](https://truedone.pages.dev) | Anyone reading a public pull request: open `truedone.pages.dev/owner/repo/pull/n` for the static verdict in the browser, with nothing to install. | Live |
| `npx truedone` | Developers, from the terminal: the current branch, or a pull request link. `--run` adds red-green, `--json` prints `truedone.verdict/1`, and `init` adds three lines to `AGENTS.md` or `CLAUDE.md` that ask a coding agent to run it. | Not released yet |
| Claude Code plugin | People working with Claude Code: a Stop hook keeps the agent from finishing when a test it changed fails, a test was weakened or disabled, or it says tests pass but has not run them since its last edit. | Not released yet |
| GitHub App | Maintainers: one check run named `truedone` and at most one `truedone:*` label per pull request. It never runs the pull request's code. | Not released yet |
| GitHub Action | Repositories that want red-green in CI: one `uses:` line in an existing job, nothing installed. It writes a report the GitHub App reads. | Not released yet |
<!-- ways: end -->

## Quick start

You need git, Node 22 or later, and Python 3 with pytest, which two tests use. There are no packages to install: the repository has no dependencies.

1. Clone the repository.

   ```sh
   git clone https://github.com/Truedone/truedone && cd truedone
   ```

2. Run the tests, which use `node:test`.

   ```sh
   npm test
   ```

3. Look at a fixture: a pull request that changes `toBe(1)` to `toBeDefined()` in a test that already exists.

   ```sh
   cat packages/core/test/fixtures/checks/assertion_weakened/js.json
   ```

4. Run the static checks from the single-file core on it, then on a change to source with no test. The first prints `verdict: 'tampered'`, the second `verdict: 'no_evidence'`.

   ```sh
   for f in assertion_weakened/js.json source_no_test/any.json; do
     node --input-type=module -e "import { analyse } from './packages/core/core.mjs'; import { readFileSync } from 'node:fs'; console.log(analyse(JSON.parse(readFileSync(process.argv[1], 'utf8'))))" "packages/core/test/fixtures/checks/$f"
   done
   ```

When the first release ships, this quick start becomes `npx truedone` on your own branch.

## Status

<!-- status: written by node tools/readme-status.mjs from the contract and main; do not edit -->
truedone is pre-release: the npm package, the action, the plugin and the app have no published release, and the release decisions stay open until a record in docs/releases says "Decision: GO".

At main cdde682ac718 (2026-10-19), 102 of the 136 tasks in the signed contract, [proofline.json](proofline.json), are on main:

- truedone.pages.dev: 13 of 14 (WEB-01, WEB-02, WEB-04, WEB-05, WEB-06, WEB-07, WEB-08, WEB-09, WEB-10, WEB-11, WEB-12, WEB-13, WEB-14).
- `npx truedone`: 3 of 3 (CLI-02, CLI-01, CLI-03).
- Claude Code plugin: 4 of 5 (PLG-00, PLG-01, PLG-02, PLG-04).
- GitHub App: 26 of 26 (APP-02, APP-01, APP-07, APP-08, APP-09, APP-10, APP-11, APP-12, APP-13, APP-14, APP-15, APP-16, APP-17, APP-18, APP-19, APP-20, APP-21, APP-22, APP-23, APP-24, APP-25, APP-26, APP-03, APP-05, APP-06, APP-04).
- GitHub Action: 2 of 4 (ACT-01, ACT-02).
- The engine they share: 18 of 19 (CORE-01, CORE-02, CORE-03, CORE-05, CORE-04, CORE-06, CORE-07, CORE-08, CORE-09, CORE-10, CORE-11, RUN-01, RUN-02, RUN-03, RUN-06, RUN-07, RUN-04, JUDGE-01).
- Measurement gates and the index: 1 of 11 (GATE-06).
- Releases: 2 of 12 (REL-01, REL-02).
- Repository, CI, deploys and docs: 33 of 42 (OPS-04, OPS-01, OPS-03A, OPS-02, OPS-03B, ENG-01, BENCH-01, BENCH-02, COLLECT-01, SEC-01, SEC-02, SEC-03, SEC-04, GUARD-01, DEP-01, DEP-02, DOM-01, AGENT-01, MCP-01, OPS-05, REPO-01, REPO-02, REPO-03, ORG-01, MET-01, MET-02, ORG-02, MAP-01, MAP-02, DOC-00, README-02, README-03, OPS-09).
<!-- status: end -->

## Contributing

Every change lands as one task from the signed contract in `proofline.json`, with a test that fails without the change and passes with it. Start with [CONTRIBUTING.md](CONTRIBUTING.md). The full specification is [docs/spec.md](docs/spec.md), and [docs/DEPENDENCY-MAP.md](docs/DEPENDENCY-MAP.md) shows how the files depend on each other. truedone is licensed under [Apache-2.0](LICENSE), and everyone taking part follows the [code of conduct](CODE_OF_CONDUCT.md).
