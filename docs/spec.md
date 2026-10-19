# truedone: build spec

Exported from the Build spec and design tabs of "The problem to give away" on 2026-10-17. This file is the specification the contract cites; only Ryan changes it.

This file is what the proofline contracts are written from. It settles every decision the design left open. Ryan confirms or changes the decisions below before he signs the contracts. Each requirement at the end has an id in proofline's `- ID: text` form, so the list can be saved as `REQUIREMENTS.md` and checked with `proofline contract coverage`.

## Decisions to confirm

Confirmed by Ryan Gillespie on 2026-10-17

Each default stands unless Ryan changes it before signing the contracts.

| # | Decision | Default set in this review | Why |
|---|---|---|---|
| D1 | Repository layout | `packages/core`, `packages/web`, `packages/cli` (CLI, plugin hook, `init`), `packages/app`, `packages/action`, and `tools/corpus` for the gates and the index. packages/core/run holds the Node-only red-green runner that the CLI, plugin and action share; core.mjs itself stays pure. On release, the action is mirrored to its own public repository, `Truedone/truedone-action` | GitHub Marketplace lists an action only from a repository whose root holds a single `action.yml` ([GitHub Docs](https://docs.github.com/en/enterprise-cloud@latest/actions/how-tos/create-and-publish-actions/publish-in-github-marketplace)) |
| D2 | Clean test changes with no run | New verdict **Tests changed: not run**, label `truedone:unrun` | Without it, rung 0, the static CLI and the app without the CI line have no verdict for the most common good PR |
| D3 | Unstable or errored runs | **Could not run**, with the reason: flaky on base, flaky on head, errored, timed out | Proven needs stable results. One label covers "no stable result" |
| D4 | Languages outside version 1 | **Not applicable**, reason "language not supported in version 1". Skip and focus markers in Go, Rust and Java test files are still flagged | "Any public PR" still gets an answer |
| D5 | Bots that are Not applicable | Dependabot, Renovate, release-please and `github-actions[bot]`, on a list in core. Agent bots (Copilot coding agent, Devin and the rest of the agent list) are always checked | The flood includes agent bots |
| D6 | Base and head | In CI, head is the commit the job checked out (GitHub's merge commit for `pull_request`) and base is its first parent. In the CLI and plugin, head is the PR head or the working tree, and base is the merge-base with the target branch | The merge commit's first parent is the base branch tip, so base to head is exactly the PR's change on today's base |
| D7 | How base is run | In place. Source files the PR changed are swapped to base: modified files get their base content, added files are removed, removed files are put back. Test files, helpers, setup files and runner config stay as on head. The tests run, then the files are restored and their hashes checked. Never a separate worktree | Workspace packages and editable Python installs resolve to the main checkout. A separate worktree would silently run head's code and report a false "passes on base" |
| D8 | Coverage condition | Node: V8 coverage through `NODE_V8_COVERAGE`, which is built in. Python: stdlib `sys.monitoring` on 3.12 and later, `sys.settrace` below. If coverage of the changed lines cannot be collected, the condition falls back to "the test imports a changed module, directly or one hop away", and the summary names the condition used | No dependency. TypeScript source maps through jest and vitest are the main unknown, spiked in week 3 |
| D9 | Report transport | The action is a JavaScript action on the runner's Node. It uploads one artifact per job through the Actions artifact service, with the client written in the file and no `@actions` packages. If the week-4 spike fails, the report is printed between markers in the job log and the app reads it through the logs API | No install and no write token |
| D10 | Which report counts | The app's own static verdict for the head SHA always stands. No report can override Tampered or Test changes: review. Among reports for that SHA from the latest run attempt, the first that reached a red-green result counts, and the others are listed | Matrix jobs write several reports |
| D11 | Mixed results across tests | The best result of any test counts, in the order Proven, Proven (new behaviour), Proven (weak), No red-green evidence. Could not run is the verdict only when no test reached a result. The rest are listed | One flaky test should not hide a proving one |
| D12 | Corpus and gate 2 baseline | Agent signals are listed per agent in `tools/corpus/agents.json`: trailers, bot logins and PR-body markers, published with the index. Agent PRs: 2,000 PRs with an agent signal, opened in one 60-day window, in public JavaScript, TypeScript and Python repositories with at least 20 stars and at least one agent-signal PR in the window. Baseline: 2,000 PRs with no agent signal from the same repositories, window and mix of open, closed and merged. PRs opened before 2024 in the same repositories are reported beside it | Merged-only against all states compares different populations. Unmarked agent PRs in the baseline shrink the gap, so the pre-2024 figure shows how much |
| D13 | Gate 3 reviewer and thresholds | Ryan, or a person he names who did not build the checks. At least 50 Tampered flags, sampling more PRs if needed. Pass: false Tampered under 5%, false Test changes: review under 20%. With red-green, missed red and false Proven each under 5% on the 200-PR sample | Proven is the one claim the design defines, and nothing measured false Proven |
| D14 | When a gate fails | It stops the release it guards. The "If it fails" column is the next plan, and Ryan decides it in writing before work continues | Removes the conflict between "stops the plan" and the fallback column |
| D15 | Gate 5 | The week-2 links go to a precomputed page per maintainer, made by the corpus job, so the anonymous rate limit does not apply. The app is offered when its static stage is live, at the end of week 4. Pass: 3 of 10 install by the end of week 6 | Twenty live pages at three to ten calls each would exceed 60 requests an hour |
| D16 | The index | A scheduled job in truedone's public repository computes it weekly from a sampled corpus, never from visitors' pages. Index #1 (week 2) is static only: per agent, the share of agent-signal PRs that change source and no test, beside the baseline. Red-green columns arrive in week 6 | The static release cannot claim proof |
| D17 | Plugin in week 3 | It blocks on the three cases using head runs only. Its red-green arrives with the week-6 proof release, after the red-green gates | Each release only after its gates |
| D18 | Upgrading the truedone step | A PR that changes only the pinned SHA of the truedone step, to the SHA of a published truedone release, is Test changes: review. Any other change to the step is Tampered. The app and the CLI read the published SHAs from the tags of Truedone/truedone-action and pass them to analyse | Otherwise every upgrade is Tampered |
| D19 | Free blocking | `.github/truedone.yml` may set `conclusion: fail-on-tampered`. Requiring Proven to merge across an organisation stays in the Team tier | Keeps the paid tier distinct |
| D20 | Lanes | Four lanes, reaching GitHub only through the lead runner (D25). lane-a: the corpus sample, the static and red-green gates, the index, gate 6, the release documents, the design documents and the README. lane-b: runner detection, truedone.pages.dev, the CLI and the plugin. lane-c: the repository skeleton, core, its runner, judge() and the release pipeline. lane-d: the CI gate, the app, the action and the deploys. Ryan: the table under "Ryan only" | Four lanes work in parallel, and core's week-1 chain stays with one lane |
| D21 | Licence | Apache-2.0, as proofline | Same as the code it is extracted from |
| D22 | Building under proofline while it has false-PASS routes | truedone's CI re-runs every task's criteria from the contract on the default branch, never from the PR, and branch protection requires that job. Ryan reads every test a task adds before he approves the task. Lifted when PL-RV01 to PL-RV05 land. While GitHub Actions do not run on the account (a billing lock from 2026-10-17, about a week), the lead runner runs that job in an isolated container (no mount, no credential, no capability, a non-root user) on GitHub's merge commit of each pull request and posts its result as the commit status "truedone-gate (lead runner, docker)"; deploys run deploy.yml's commands the same way from a clean checkout of main, production only after Ryan's yes. This ends when Actions run again (Ryan, 2026-10-17). The gate never edits the contract: it restores proofline.json, proofline.json.sig and guard/ byte for byte from main, deletes nothing, and passes a task whose only failures are its ci.env_bound criteria (SEC-03 replaces SEC-01's copy of the contract without them) | The CI re-run closes routes C3, C4 and C5 for this repository; Ryan signing contract changes covers C2, and his read of new tests covers C1 |
| D23 | Dependencies anywhere in the repository | No package.json declares dependencies or devDependencies. Tests use node:test, the single files come from tools/bundle.mjs, Chrome checks use the system Chromium, and deploys run wrangler through npx | Zero dependencies is the product's claim, and a dev dependency is supply-chain surface in the release path |
| D24 | Where truedone.pages.dev reads from | The PR, its file list and its merge base come from api.github.com. File contents come from raw.githubusercontent.com, which allows any origin and does not use the API quota; a changed file's base content is read at the merge base, as GitHub's own file list is. A PR of 300 files takes 5 API calls | Fetching contents through the API, five changed test files would already exceed 10 calls, against an anonymous limit of 60 an hour |
| D25 | How work reaches main | The repositories are Truedone/truedone, Truedone/truedone-action and Truedone/truedone-sandbox. Lanes commit in their own clones under their lane names, truedone-lane-a to truedone-lane-d, and hold no GitHub credential. The lead runner pushes each task branch and opens one pull request per task with Ryan's login; merge commits only. .github/CODEOWNERS lists Ryan for the contract, spec, gates, releases, ops records and workflows. Ryan signs his own records with his SSH key (.github/allowed_signers), and his tasks check that signature. The weekly index goes to the unprotected branch index-data | Ryan chose his own account on 2026-10-17: no organisation or machine account to create. GitHub does not let an author approve their own pull request, so the CI gate is the check on every pull request, and Ryan reads each test a task adds before he merges (D22). A squash merge would leave task commits off main |
| D26 | Deploys | Only .github/workflows/deploy.yml deploys, on push to main: environment dev without approval, production after Ryan approves. The Cloudflare token lives in those environments; no lane holds it. There is no domain: Cloudflare Pages serves the truedone site as the project truedone at https://truedone.pages.dev, and the production app, the development app and the token exchange are the Cloudflare Workers truedone, truedone-dev and truedone-exchange on the account's workers.dev subdomain: https://truedone.ledgerguard-global.workers.dev, https://truedone-dev.ledgerguard-global.workers.dev and https://truedone-exchange.ledgerguard-global.workers.dev. The GitHub App lists two callback URLs, in this order: the production Worker's https://truedone.ledgerguard-global.workers.dev/api/github/callback and the site's sign-in, https://truedone.pages.dev/signin/callback, to which GitHub returns a visitor who signs in (WEB-02); its webhook, redirect and setup URLs are on the production Worker | Keeps secrets off agent machines (S5). Ryan decided on 2026-10-17 to register no domain: pages.dev and workers.dev need none, and Cloudflare Pages keeps the site's headers, redirects and path routes |
| D27 | What the CI gate re-runs | Every criterion of the PR's task, from the signed contract on main, except those listed under ci.env_bound, which need an account or a live service. The lane runs those after the merge on its own machine; Ryan re-runs the live ones at each release decision | GitHub Actions has no lead runner login, sandbox token or deployed Worker. Skipping by a signed list keeps the choice out of the lanes' hands |
| D28 | Dependency map | docs/DEPENDENCY-MAP.md puts every file in a node. tools/depmap-check.mjs fails a change that leaves a file unmapped or changes a node without the nodes it must update, and prints the nodes to review upstream and downstream. Every task checks it | A change to the spec, the contract or the code reaches every document and file that depends on it |
| D29 | Design documents | Each section of this spec, the decisions and the requirements list excepted, has a document under docs/design/ with a Mermaid flow diagram and a Mermaid schematic; docs/design/00-master.md joins them in one master schematic, checked by tools/docs-check.mjs. A change to this spec changes the documents of its sections (D28) | One picture per part and one of the whole |
| D30 | README | README.md stays short: a summary of at most 60 words, one Mermaid flowchart, a quick start of one to five steps and at most 150 lines, checked by tools/readme-check.mjs. A second lane runs the quick start from a clean directory and records its review. Its Status section is written by tools/readme-status.mjs from the signed contract and main's first-parent history and names the main commit it describes; after each landing the lead regenerates it in a signed commit "docs: README status at <short sha>" (README-02) | A first-time visitor gets from the page to a verdict in a few steps |
| D31 | Repository standard | The repository carries CONTRIBUTING.md with the Developer Certificate of Origin, CODE_OF_CONDUCT.md (Contributor Covenant 2.1), NOTICE, CHANGELOG.md, issue and pull request templates, a description, the homepage and topics, and a dependency map a person can read: an explanation, a labelled diagram and a table of every node, kept in step with the json block the check reads | The owner asked for a gold-standard repository, and an outside contributor finds how to take part in the files GitHub shows first |
| D32 | When truedone.pages.dev goes live | The site goes live, unannounced, when DEP-01 merges: deploy.yml's web job deploys packages/web to the Pages project truedone on every push to main, in environment dev. REL-W2's GO no longer makes the site live; it governs the npm release, index #1 on the index-data branch and the launch post, which Ryan posts himself (Ryan, 2026-10-17: "agree and approve with all waiting") | The site holds no secret and never runs PR code (S3), so it can serve before the launch; the launch post is what announces it |
| D33 | The next step | The Result's `next` is what would change the verdict, so it is built from the reasons that give the result's own verdict: one sentence per group of them, in the table's order. Under Tampered: restore an equivalent test for skip, focus, weakened or a tampered deletion, and pin the step for a step change. Under Test changes: review: confirm the test change is intended for parametrised, timeout, snapshot or a review deletion, and confirm the step change for a re-pin to a release. A verdict whose reasons fall in no group keeps its What to do next text. A lesser finding, such as an unrun reason under Tampered, keeps its reason line, marked by its verdict, and adds no sentence, since running the tests cannot change a Tampered verdict. Each reason carries the verdict it alone gives (CORE-09, issue #56; 2026-10-18) | A PR whose only reason was a weakened assertion was told to pin a step it never touched, and a snapshot update would be told to restore a test; the advice must follow what was found, and only what would change the verdict |
| D35 | The preview release | Ryan decided on 2026-10-18 to ship a preview release, 0.1.0, before the go-or-stop records: the command line on npm, the action on Truedone/truedone-action, the production App made public, and the plugin from this repository's marketplace, each labelled preview in its own output, and none announced. It is held to the same proof as a release: a surface counts as released only after a walk of its install path from a fresh home, on the sandbox's demonstration pull requests, gives the expected verdict, and only then does its entry in packages/web/lib/release.mjs flip, which the site and the README read. The production App posts only after the development App's smoke passes on the sandbox. Publishing to npm and changing the App's visibility are Ryan's own steps. The go-or-stop records (REL-W2 to REL-W6) still govern the launch: the announcement, index #1, the marketplace submission and the second wave (Ryan, 2026-10-18: "make the production App public, and the preview release. make sure its gold standard") | Visitors could use only the site; a preview lets anyone install each part now, while the launch keeps its gates |
| D36 | The Truedone organisation | Ryan decided on 2026-10-18 to move the repositories to the GitHub organisation Truedone, a free organisation he owns: Truedone/truedone, Truedone/truedone-action and Truedone/truedone-sandbox. GitHub Actions on his account stay locked for billing for at least two weeks, and the organisation runs hosted jobs (Truedone/actions-probe ran one on 2026-10-18). The development App belongs to the organisation and is installed only on Truedone/truedone-sandbox; the production App stays on his account. GitHub redirects the old addresses. The rest holds: commits on main are signed with his key, the lead runner logs in as mgillr, an owner of the organisation, and the container gate of D22 stays the required check until hosted Actions are proven on the repository (Ryan, 2026-10-18: "ok done https://github.com/Truedone, start moving everything over and testing") | The action, the sandbox's own job and the CI gate need hosted Actions, which his account cannot run during the lock |
| D37 | The label speed target | Ryan decided on 2026-10-18 that the App's label speed is held in two parts: the pull request opened to label at p50 at most 3 s, measured from GitHub's own events in whole seconds, and the App's own time to the label under 1.5 s at p50, measured from its phase line (the switch and the label chain, from the delivery's arrival). After five rounds (APP-17 to APP-22) the GitHub-measured p50 read exactly 3.0 s on every bench, because GitHub's webhook delivery (1.2 to 2.2 s) and its label write (about 0.7 s by every method tried) take about 2.4 s of the 3 s themselves, and whole-second timestamps put a 2.4 to 2.9 s label at 3 s. The App's own share measured about 1.1 s. The p95 target of 15 s is unchanged (Ryan, 2026-10-18, in chat: "Two-part gate") | A target that GitHub's own floor decides cannot be met by the App's work, and a strict reading at whole-second resolution hid what the App controls |
| D38 | The verdict travels with the agent's work | Ryan decided on 2026-10-18 that truedone spreads through the coding agents of the developers who chose it. `npx truedone --pr-line` prints one line for a pull request description: the verdict, its one-sentence reason and the link to the verdict's public page. `init` adds a fourth snippet line telling the agent to put that line in the pull request it opens. `init --global` writes the snippet to the developer's own global agent instruction files, so it travels to every repository they contribute to. `npx truedone mcp` serves the check to any agent that speaks the Model Context Protocol. The public pull request page offers the App's install link for that repository. No truedone process opens a pull request, issue or comment on a repository that did not install it (Ryan, 2026-10-18, in chat: "we need agents to spread it like wild fire") | The maintainer who decides on an install reads the line on their own repository while reviewing agent work, one click from a page that recomputes it; a bot that posted uninvited would be spam |
| D39 | The wrong-verdict collector | Ryan decided on 2026-10-18 that every verdict someone finds wrong is collected with enough data to reproduce it. Each check run and each public pull request page carries a link, This verdict is wrong, to a structured issue form on Truedone/truedone: the pull request, its head and base commits, the verdict shown, what is wrong (a false alarm, a missed tamper, missed evidence or the wrong class) and the truedone version, and no pull request text. `npx truedone report <PR>` fills the form from the verdict it computes and sends nothing itself. For a public pull request the lead runner snapshots the public record at the reported commits into the private repository Truedone/truedone-misses, and a confirmed report becomes a minimal BENCH-01 case written from it, so it is checked on every change from then on. The organisation page counts reported, confirmed and fixed reports (Ryan, 2026-10-18, in chat: "There needs to be a collector mechanism where PRs that truedone didnt catch or got wrong are submitted with full data for analysis") | Every miss found in use hardens the tool for good, and the counts are the public record of false alarms and misses; another project's code is kept privately, never copied into this repository |
| D40 | Knowledge, never a worm | Ryan decided on 2026-10-19 that truedone spreads as knowledge a developer or an agent chooses to use, never as something that copies itself. Every text truedone gives an agent (llms.txt, the lines `init` writes, the MCP server's instructions, the skill and the plugin's README) asks the agent only to check its own work: run the check, keep every test as strong as it was, and report the verdict as printed. None asks anyone to install, recommend or spread truedone, and none asks an agent to write to a file or repository its user did not name. truedone writes a file only when its user runs a command that names it (`init`, `init --global`); it prints each file it wrote, and deleting those lines undoes it. The App writes only on repositories that installed it, one check run and at most one label, and its summary never addresses the pull request's author (PV-C15). Each directory listing says what truedone does and what it never does, and nothing more (Ryan, 2026-10-19, in chat: "ensure it will not be seen as spam or virus like spreading but knowledge spreading to ensure the integrity of PRs for optimal agent performance") | An instruction that tells an agent to pass a tool on has the shape of a prompt-injection worm: agent hosts and directories treat it as malware, and a maintainer who finds one stops trusting every verdict. Knowledge an agent can check, in the places agents already look, spreads on its merits |

## core

Two pure functions in one ES module, with no I/O.

```text
analyse(input) -> Result                 static checks only
judge(staticResult, reports) -> Result   adds red-green reports

input = {
  files: [{ path, status: "added" | "modified" | "removed" | "renamed",
            previous_path?, patch?, base?: string, head?: string }],
  pr: { title, body, author: { login, type } },
  releases?: [sha],          published truedone action SHAs (D18)
  limits?: { files, lines, fetched }
}
  files follows the GitHub PR files API. base and head contents are
  given only for test, setup, runner-config and workflow files.

Result = {
  schema: "truedone.verdict/1",
  verdict: "tampered" | "review" | "could_not_run" | "proven"
         | "proven_new" | "proven_weak" | "no_evidence" | "pending"
         | "unrun" | "not_applicable",
  label: string | null,
  partial: boolean,
  reasons: [{ check, file, line?, message, verdict }],   one line each, at most 10 shown; verdict is the verdict that reason alone gives
  next: string                                   what would change the verdict
}
```

The starting code is in proofline: `src/forbidden.mjs` (skip, focus, timeout and assertion patterns), `src/checks.mjs` (`TEST_FILE_RE`, hunk parsing), `src/infer.mjs` (changed tests, runner commands, test-command changes) and `src/hook-stop.mjs`. All of it reads git and the file system, so it is ported to pure functions, not copied. proofline has no runtime dependencies today.

## Checks and verdicts

**File classification.** The first rule that matches wins.

| Class | Rule |
|---|---|
| Truedone config | `.github/truedone.yml` |
| Workflow | `.github/workflows/*.yml` and `*.yaml` |
| Runner config | `jest.config.*`, `vitest.config.*`, `vite.config.*`, `.mocharc.*`, `pytest.ini`, `tox.ini`, `setup.cfg`, the `[tool.pytest.ini_options]` table of `pyproject.toml`, and the `scripts.test` and `jest` keys of `package.json` |
| Setup file | `conftest.py`, `jest.setup.*`, `vitest.setup.*`, `setup-tests.*`, and files named in `setupFiles`, `setupFilesAfterEnv` or mocha `require` when the config is JSON |
| Test file | JS and TS: `*.test.*`, `*.spec.*`, and files under `test/`, `tests/` or `__tests__/`. Python: `test_*.py`, `*_test.py`, and files under `tests/`. Custom `testMatch` or `python_files` patterns are read from JSON, INI and TOML configs. JavaScript config files are never evaluated: defaults apply and the summary says so |
| Test helper | Non-test files under a test directory, fixtures, `__snapshots__/`, `*.snap` |
| Lockfile | `package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`, `poetry.lock`, `uv.lock`, `Pipfile.lock` |
| Dependency manifest | The dependency keys of `package.json`, the dependency tables of `pyproject.toml`, `requirements*.txt` |
| Docs | `*.md`, `*.rst`, `docs/`, `LICENSE*`, `CHANGELOG*` |
| Source | Everything else |

**Each check and its verdict.** Checks run per test, matched by name. They replace proofline's net count of assertion lines per file.

| Check | Example | Verdict |
|---|---|---|
| Skip or disable added to a test that exists at base | `it.skip`, `xit`, `@pytest.mark.skip`, `skipif`, `xfail`, `t.Skip`, `#[ignore]`, `@Disabled`; `pytest.skip()`, mocha's `this.skip()` or node's `t.skip()` called in the test body | Tampered |
| Focus added | `.only`, `fit`, `fdescribe` | Tampered |
| Assertion removed from, or weakened in, a test that exists at base, with no equivalent | `toBe(3)` to `toBeDefined()`; `assert a == b` deleted; an assertion commented out | Tampered |
| Test deleted, its normalised body found nowhere in head |  | Tampered if the source it imported still exists; Test changes: review if that source was deleted too |
| Test moved or renamed: the same body after removing whitespace and comments |  | No finding |
| Snapshot updated; a parametrised case removed |  | Test changes: review |
| Timeout raised, in a test or runner config |  | Test changes: review |
| Runner config, setup file, test script or workflow changed, other than the truedone step |  | Test changes: review |
| Truedone step re-pinned to a published truedone release |  | Test changes: review |
| Truedone step removed, edited or pinned to any other SHA |  | Tampered |
| PR body says tests were added, and no test file changed | "adds tests" | A reason line on No red-green evidence, never a verdict alone |
| Source changed and no test file changed |  | No red-green evidence |
| Test files changed, nothing above, no report |  | Tests changed: not run |
| Docs, a lockfile or dependency-manifest change, a listed bot, a pure rename, or a workflow change that touches no test and not the truedone step |  | Not applicable |

**Equivalent** means the same test on head has at least as many assertion calls as on base, and none moved down the weakening list. The list: `toBe`, `toEqual` and `toStrictEqual` down to `toBeDefined`, `toBeTruthy`, `not.toBeNull` or `toBeTypeOf`; `assert x == y` down to `assert x`; `assertEqual` down to `assertTrue` or `assertIsNotNone`; node's `assert.equal`, `strictEqual`, `deepEqual` and `deepStrictEqual` down to `assert.ok` or a bare `assert`. An assertion call does not count when it is commented out, when its subject and expected value are both literals (`expect(true).toBe(true)`, `assert.ok(true)`, as `assert True` already is in Python), when it follows an unconditional `return` in the test body, when it sits under `if (false)` or `if (0)`, or when it is inside a `try` whose `catch` does not rethrow. A test hollowed this way passes on base, so red-green gives it No red-green evidence and never Proven; the static check is what labels it Tampered (CORE-07).

**Red-green outcomes, per test.** The first row that matches wins.

| Base, two runs | Head, three runs | Result for that test |
|---|---|---|
| Both fail by assertion | All pass, and the coverage condition (D8) holds | Proven |
| Both fail only because a symbol the diff adds is missing | All pass, and an assertion line names that symbol or a variable assigned from it | Proven (new behaviour) |
| Either of the two rows above | All pass, condition not met | Proven (weak) |
| Both pass | All pass | No red-green evidence |
| One fails and one passes | Any | Could not run: flaky on base |
| Any | One or two pass | Could not run: flaky on head |
| Any | None pass | No red-green evidence, reason "fails on head" |
| Fails with any other error | Any | Could not run: errored, with the error type |
| A run exceeds 5 minutes |  | Could not run: timed out |

Failing by assertion means `AssertionError`, Node's `ERR_ASSERTION`, or a jest or vitest matcher failure. A missing symbol means `ImportError`, `ModuleNotFoundError`, `AttributeError`, `ReferenceError` or "is not a function", naming a symbol the diff adds. Any other import, collection or setup error is never red.

There is one red-green table: judge() takes each test's result from outcome() in packages/core/src/outcome.mjs, which the runner uses too (CORE-07). Before the table applies, a test without two base runs and three head runs, because a run produced no result for it, is Could not run with the reason "incomplete runs", never No red-green evidence; the runner keys each row by the test file's path and the test's name, so a base row pairs with its head rows and two files with a same-named test stay two rows (RUN-06).

**Reason lines.** Each finding of a row of the checks table gives one line of `reasons` (Result shape). `check` is the key of its row, in the table's order: `skip`, `focus`, `weakened`, `deleted`, `snapshot` and `parametrised` (the two findings of one row), `timeout`, `runner_config`, `step_release`, `step`, `claim`, `no_test`, `unrun` and `not_applicable`; a moved or renamed test gives no line. `file` is the path of the changed file, and empty for `claim`. `line`, when given, is where the test or the step starts on head, or on base for a deleted test or a removed step. `message` is one line from core's message templates that names the test for `skip`, `focus`, `weakened`, `deleted` and a timeout raised in a test, and the file for the others. The `claim` line is given only with No red-green evidence, and the `unrun` and `not_applicable` lines only when they give the verdict. The `bot`, `language`, `skip_focus` and `partial` lines (D4, D5, Limits) keep those keys. Lines come in row order, then path order, and analyse() returns at most 10; on a partial PR the `partial` line is always the last of them.

**Red-green reason lines.** judge() returns the whole Result: the label of its verdict, `partial` from the static result, `next`, and its lines. When the static verdict stands (Tampered, Test changes: review) or no report counts, the lines are the static result's. Otherwise each test of the report that counts gives one line, check `red_green`, file the test file, with a message that names the test, its result in the outcomes table with the reason (flaky on base, flaky on head, errored with the error type from the report's `could_not_run` detail, timed out, fails on head), and the coverage condition used (D8); each other report of the latest attempt gives one line, check `report`, naming its job (D10). A report whose `could_not_run` is set and that ran no test gives Could not run with one line, check `could_not_run`, naming its reason and detail. The static lines follow, and judge() returns at most 10.

## Report, configuration, labels and limits

**The report from the action to the app.** One artifact per job, named `truedone-report-<job id>`. At most 256 KB, one file and 500 tests. The app refuses anything larger or of another shape.

```text
{
  schema: "truedone.report/1",
  head_sha, checked_out_sha, base_sha, truedone_version, runner, job,
  tests: [{ file, name,
            base: ["fail:assertion" | "fail:missing" | "fail:error" | "pass" | "timeout", x2],
            head: ["pass" | "fail" | "timeout", x3],
            condition: "lines" | "imports" | "none",
            asserts_new_symbol: boolean, duration_ms }],
  could_not_run: null | { reason: "runner" | "service" | "setup" | "timeout"
                                | "flaky" | "error", detail },
  truncated: boolean
}
```

**Runners.** Version 1 detects vitest, jest, mocha, `node --test` and pytest. Each writes its result through its own built-in reporter: jest `--json`, vitest `--reporter=json`, mocha `--reporter json`, `node --test --test-reporter=junit`, pytest `--junitxml`. Detection reads the `package.json`, `pyproject.toml`, `pytest.ini` and `setup.cfg` in each directory from a changed test file up to the repository root, and takes the nearest one that names a runner.

**Configuration.** `.github/truedone.yml` is optional. It holds flat `key: value` lines only, read by a small reader in core with no YAML library. Unknown keys are ignored and named in a reason line.

| Key | Values | Default |
|---|---|---|
| `test` | A command with `{files}` | Detected |
| `comments` | `off`, `on` | `off` |
| `conclusion` | `neutral`, `fail-on-tampered` | `neutral` |
| `ignore` | Comma-separated globs | None |
| `enabled` | `true`, `false` | `true` |

**Labels, check run and comment.**

- One check run named `truedone` per head SHA. The static result is posted first, then updated in place with red-green.
- Exactly one `truedone:*` label on a PR at any time. It is replaced when the latest head's verdict changes, and removed for Not applicable.
- Labels are created on first use, with fixed colours and descriptions under GitHub's 100-character limit, ending in `truedone.pages.dev/why`. That page is a static page of the site, packages/web/why.html, that lists the eight labels, each with its verdict, when it is given and what to do next, in the words of the verdicts table below.
- The comment is posted only when `comments: on`. There is one, edited in place.
- The summary gives the verdict, up to 10 one-line reasons, what would change the verdict, and the truedone.pages.dev link.

**Limits.**

- Static: up to 300 changed files, 20,000 changed lines and 100 fetched files. Beyond that, files are analysed in path order up to the limit, and the verdict carries "(partial)". A partial PR is never Not applicable.
- Red-green: up to 50 changed tests, 5 minutes a run and 20 minutes for the whole step.

## cli and plugin

| Command | Does |
|---|---|
| `npx truedone` | The current branch against the merge-base with the default branch. Static |
| `npx truedone <PR link or owner/repo#n>` | Static, through the API. Nothing is cloned |
| `--run` | Adds red-green. On your own branch it runs at once. On anyone else's PR it clones to a temporary directory, says it will execute that PR's code, and waits for a typed `yes` or `--yes` |
| `--docker` | Red-green inside `node:24-slim` or `python:3.12-slim` |
| `--json` | Prints `truedone.verdict/1` |
| `--fail-on <verdicts>` | Exit 1 when the verdict is in the list |
| `init` | Adds the snippet to each agent instruction file the repository already has: `AGENTS.md`, `CLAUDE.md`, `GEMINI.md` and `.github/copilot-instructions.md`. When it has none, creates `AGENTS.md`. Never edits existing lines, and prints each file it wrote and that deleting those lines undoes it (D40) |
| `init --global` | Adds the snippet to the developer's global agent instruction files: `~/.claude/CLAUDE.md`, `~/.codex/AGENTS.md` when `~/.codex` exists, and `~/.gemini/GEMINI.md` when `~/.gemini` exists. Never edits existing lines, and prints each file it wrote (D38, D40) |
| `--pr-line` | Prints one line for a pull request description: the verdict, its reason and the link to the verdict's public page (D38) |
| `report <PR link>` | Prints the wrong-verdict form's link, filled with the pull request, its commits, the verdict and the truedone version. Sends nothing (D39) |
| `mcp` | Serves the check over the Model Context Protocol on stdio, as tools for a pull request and for the current branch (D38) |

Exit codes: 0 when a verdict is produced, 1 when `--fail-on` matches, 2 for a usage error, 3 for an internal error.

**The plugin** is a Claude Code plugin with one Stop hook, declared in `hooks/hooks.json` and run as `node "${CLAUDE_PLUGIN_ROOT}/hooks/stop.mjs"`: a single file with core bundled in. It makes no network calls and keeps any state in `${CLAUDE_PLUGIN_DATA}`. It also carries one skill, `skills/truedone/SKILL.md`, which tells the agent when to run `npx truedone` and how to report its verdict; the same file is at `skills/truedone/SKILL.md` in the repository root, for any agent that reads the Agent Skills format (D40). The truedone repository holds `.claude-plugin/marketplace.json`, so two commands install it: `/plugin marketplace add Truedone/truedone`, then `/plugin install truedone@truedone` (Claude Code 2.1.275 or later). It is also submitted to the official marketplace, after which `/plugin install truedone@claude-plugins-official` works ([install](https://code.claude.com/docs/en/plugins/install), [components](https://code.claude.com/docs/en/plugins/components)).

| Case | Blocks? |
|---|---|
| A test the agent added or changed fails on a fresh run | Yes |
| A test was weakened or disabled (Tampered) | Yes |
| The agent's last message claims tests pass, and the changed tests were not run after its last file edit, judged from the transcript's tool-call order | Yes |
| No red-green evidence, such as a refactor with no test | No. Shown once to the user |
| Test changes: review | No. Shown to the user |
| Three blocks in a row with no change since the last one | No. The agent stops and the finding is shown to the user |

The plugin's own limit of three blocks sits well under Claude Code's override of a Stop hook after eight blocks in a row with no tool call in between ([hooks guide](https://code.claude.com/docs/en/hooks-guide)). Before the plugin task starts, lane-b reads the hooks reference for the Stop hook's input fields (the transcript path), its exit-code behaviour and its user-visible message field, and records them in the task. If there is no user-visible field, a finding that does not block goes through one block whose reason asks the agent to state it, and never a second.

## Safety rules

| # | Rule |
|---|---|
| S1 | The CLI and plugin never leave the user's files changed. Before the base swap they record the changed files' contents and hashes in `.git/truedone-restore`. Afterwards they restore the files and check every hash. A run that finds the record restores first. If a file changed during the run, they stop and say so |
| S2 | In CI the action restores the checkout exactly: the same HEAD and the same `git status --porcelain` output as before. Otherwise the step reports Could not run and fails |
| S3 | truedone's app and website never execute PR code. The gate harness runs sampled PRs on GitHub-hosted runners in truedone's public repository, with `permissions: {}`, no secrets and no cache shared with releases |
| S4 | When the CLI runs someone else's PR, the PR's code gets the environment minus every variable ending in `_TOKEN`, `_SECRET`, `_KEY` or `_PASSWORD`, and minus `AWS_*`, `AZURE_*`, `GOOGLE_APPLICATION_CREDENTIALS` and `NPM_CONFIG_*` |
| S5 | The app's private key, webhook secret and OAuth client secret exist only as Cloudflare Worker secrets that Ryan sets. They are never in the repository or on an agent machine. Lanes test against a separate development app installed only on `Truedone/truedone-sandbox`, with its own key |
| S6 | Webhooks: the signature is checked in constant time, each delivery id is handled once, and events for removed installations are dropped. Artifacts over 256 KB, or holding more than one file, are refused before unzipping |
| S7 | PR titles, bodies and paths are shown as text only. truedone.pages.dev uses no `innerHTML` for them and sets a content security policy that allows scripts from itself, and connections only to itself (the precomputed pages), `api.github.com`, raw.githubusercontent.com (D24) and the token exchange https://truedone-exchange.ledgerguard-global.workers.dev (D26, WEB-02). Check summaries and comments escape Markdown and neutralise `@` mentions taken from PR content |
| S8 | The Worker logs installation id, repository id, PR number, verdict and timings, never diff content, file contents or PR text. The sign-in token stays in the visitor's session storage, requests no scopes, and is sent only to `api.github.com` |

## Release requirements

All are met before the app is offered at the end of week 4, and still met at the week-6 proof release.

| # | Requirement |
|---|---|
| R1 | `LICENSE` (D21), `SECURITY.md` with a contact address, and a privacy note and terms on truedone.pages.dev that say what the app reads and stores, and for how long |
| R2 | npm releases go through trusted publishing from the release workflow, with provenance. No npm token on any machine. The release job needs Ryan's approval |
| R3 | The action is released by tag and SHA to `Truedone/truedone-action`. The app knows the published release SHAs (D18) |
| R4 | Monitoring and alerts to Ryan: webhook errors, queue age, label latency p50 and p95, and a dead-letter queue |
| R5 | A switch that stops all posting within one minute without a deploy, and `enabled: false` per repository |
| R6 | On uninstall, stored data for that installation is deleted within 24 hours. Labels already set stay, and the README says so |
| R7 | A load test at 1,000 installs' webhook volume before the app is offered, with the measured cost published |
| R8 | The index has a public corrections log and a contact, and a correction is published within one week |

## Ryan only

| Item | Week |
|---|---|
| Register npm `truedone`, the repository Truedone/truedone and the Cloudflare Pages project truedone; no trademark search is run (Ryan, 2026-10-17) | 1 |
| Cloudflare account, GitHub App registration, the private key into Worker secrets, and the development app | 1 |
| No credential on the lanes: only the lead runner reaches GitHub, with your login (D25) | 1 |
| Confirm or change D1 to D31, then sign and commit the contracts | 1 |
| Gate 3 and false-Proven reviews, or name the reviewer | 1 and 5 |
| Maintainer outreach, the launch posts and the recording, sent as himself | 2 to 6 |
| Privacy note, terms and the `SECURITY.md` contact | 4 |
| Gate 6 check, and the go or stop decision for each release | 2 and 6 |
| The paid pilot: price, buyer and date | Its own task |
| .github/allowed_signers with your SSH key (D25) | 1 |
| Environments dev, production and release, the Cloudflare token, the mirror token, and the ruleset with the CI gate and merge commits only (D25, D26) | 1 and 2 |
| The first npm publish by hand, then trusted publishing for every later release | 2 |


## From the design: verdicts

Every PR gets exactly one verdict, chosen by the precedence below. Every verdict except Not applicable sets a label, so a maintainer can filter the PR list without reading anything. The check conclusion is neutral by default, so it never blocks a merge unless the maintainer turns that on. A large PR that was only partly analysed gets "(partial)" after its verdict. The file classes, limits and the verdict each check gives are in the sections above.

| Verdict | Label | From the diff alone? | Given when | What to do next |
|---|---|---|---|---|
| **Tampered** | `truedone:tampered` | Yes | A test that existed at base is disabled, focused or weakened, and nothing equivalent is added; or this PR removes, edits or re-pins the truedone step, other than to a published truedone release | Restore an equivalent test, or pin the step to a published release. |
| **Test changes: review** | `truedone:review` | Yes | Tests moved, removed or rewritten in a way that may be legitimate (a snapshot update, a parametrised case dropped, a deleted test whose source was deleted too); a raised timeout; a change to the test runner config, a setup file, the test script or the workflow that holds the truedone step; the truedone step moved to a newer published release | Confirm the test change is intended. |
| **Could not run** | `truedone:could-not-run` | No | No test reached a result: the runner, a service or a setup step was missing, the results were flaky, or a run errored or timed out. The reason is named | Fix the named reason and run again. |
| **Proven** | `truedone:yes` | No | A test in the PR fails on base by assertion (twice), passes on head (three times out of three), and runs lines the PR changed | Review the rest of the change as usual. |
| **Proven (new behaviour)** | `truedone:yes` | No | A test fails on base only because a function or module the PR adds does not exist yet. On head it passes three times out of three, makes at least one assertion on that new code's result, and runs lines the PR changed. Without that assertion it is Proven (weak) | Review the rest of the change as usual. |
| **Proven (weak)** | `truedone:weak` | No | Red-green holds, but the test runs none of the changed non-test lines or asserts nothing about them | Make the test run the changed lines and assert on them. |
| **No red-green evidence** | `truedone:no-evidence` | Yes, when no test file changed | Source changed, and no test in the PR fails without the change | Add a test that fails before the change and passes after it. |
| **Waiting for approval** | `truedone:pending` | No: GitHub's run status | Tests changed and the repository has the truedone step, but GitHub is holding the run for a first-time contributor. The static findings are shown meanwhile | Approve the run on GitHub. |
| **Tests changed: not run** | `truedone:unrun` | Yes | Tests were added or changed with nothing weakened, and no red-green has run: the repository has no truedone step, or the verdict comes from truedone.pages.dev or the static CLI | Run the changed tests: the next rung. |
| **Not applicable** | none | Yes | Docs only; a lockfile or dependency change; a dependency or release bot (Dependabot, Renovate, release-please; agent bots are always checked); a CI-only change that touches no test and not the truedone step; a pure rename; a language version 1 does not support, with the reason shown | Nothing. |

The Result's `next` is built from the reasons that give its verdict (D33): one sentence per group of them, in the table's order; a verdict whose reasons fall in no group keeps its What to do next text, and a lesser finding adds no sentence.

**Precedence**, highest first: Tampered, Test changes: review, Could not run, Proven, Proven (new behaviour), Proven (weak), No red-green evidence, Waiting for approval, Tests changed: not run, Not applicable. Could not run applies only when no test reached a result. When several tests ran, the best result of any test stands and the others are listed.

**Wording rule.** A verdict states what was observed about the change. It never says "safe" or "correct" and never addresses the author.

## From the design: release gates

Two sets of gates, so speed does not cost honesty. The static gates (1 to 4) need only GitHub API reads over a corpus and a person's review of 200 flags, about two days of work, and must pass before the week-2 public release. The red-green gates (3 and 4 repeated with execution, plus 5) must pass before the red-green release. A failed gate stops the release it guards; it is not a number to explain away. The last column is the next plan, and Ryan decides it in writing.

| # | Question | How it is measured | Pass | If it fails |
|---|---|---|---|---|
| 1 | Are PRs without proof common? | Static: the share of 2,000 public PRs with an agent signal (Co-Authored-By or Assisted-by trailers, agent bot authors, agent PR markers) that change source and no test. The PRs are opened in one 60-day window in JavaScript, TypeScript and Python repositories (sample spec: Build spec D12). Red-green later, on a sample of 200 | At least 10% | The problem is smaller than the reporting suggests: stop |
| 2 | Does the label separate AI PRs from human ones? | The same measurement on 2,000 PRs with no agent signal, from the same repositories, window and mix of open, closed and merged. PRs opened before 2024 in the same repositories are reported beside it, as a check on unmarked agent work | The agent PRs' share is at least 10 points higher | The label does not filter the flood: reposition as a general quality check, or stop |
| 3 | Is it quiet and right enough to keep? | Ryan, or a person he names who did not build the checks, reviews 200 Tampered and Test-changes flags (at least 50 Tampered) on PRs maintainers merged. With red-green, on the 200-PR sample: missed red (a PR test does fail on base, but truedone said no evidence) and false Proven (the test does not exercise the change) | False Tampered under 5%; false Test changes: review under 20%; missed red and false Proven each under 5% | Fix before releasing; never release at 5% or above |
| 4 | Does it run with no configuration? | Static: runner detection across the corpus repositories. With red-green: the share whose changed tests actually ran | 70% or more with no config line | Add runners or a one-line config |
| 5 | Do maintainers want it? | Ten maintainers of projects that have described AI-PR load in public, whom Ryan picks from docs/gates/gate5-candidates.tsv (the sample's repositories ranked by agent PRs times their share that change source and no test, PROS-01), each with a link to that statement, get a precomputed truedone.pages.dev page of their own last 20 PRs in week 2, and the app when it is live at the end of week 4 | At least 3 install the app by the end of week 6 | They want something else: rethink the app, keep the other rungs |
| 6 | Is the window still open? | Ryan checks the watch list before each release: the GitHub changelog, Copilot code review, CodeRabbit, Test Ratchet, Skylos, tamperguard, checkwash and donegate, and any GitHub guidance that recommends a test failing on the pre-change behaviour (GATE-06) | None ships a red-green or test-tamper check first | Lead with the plugin, the index and the paid tier |

Gates 1 and 2 also produce the launch post: the measured share of agent PRs that prove nothing, against the human baseline. Nobody else has that number.

Before the proof release, a public demonstration on Truedone/truedone-sandbox runs the published npm version and the action's published tag on one pull request per case, every verdict of the precedence list among them, and compares each truedone check and label with docs/demo/expected.json; docs/demo.md publishes the table with its links (DEMO-01).

## From the design: threat model

**Threat model, stated in the README.** truedone catches careless agents and lazy shortcuts, which is the flood maintainers describe. Someone who controls a PR also controls the test code that runs in it. The static checks flag changes to runner config and setup files, but nothing on the PR side is a security boundary, and the README says so.

## Requirements

Copy this list into `REQUIREMENTS.md`. Every task names the ids it serves in its `requirements` field, and `proofline contract coverage REQUIREMENTS.md` must report none missing before Ryan signs. The list was checked with proofline's own parser: 68 ids, no duplicates.

- PV-C01: core is one ES module with no runtime dependencies, under 60 KB minified (not gzipped), and the same file loads in Node 22, Chrome and workerd
- PV-C02: core exports analyse and judge as pure functions; they do no I/O and return truedone.verdict/1
- PV-C03: Files are classified by the File classification table; each row has a fixture test
- PV-C04: Every row of the checks table gives its verdict on a fixture PR, in JavaScript, TypeScript and Python
- PV-C05: Assertion weakening is judged per test by the equivalence rule, never by a net count of lines per file
- PV-C06: A moved or renamed test with the same normalised body gives no finding
- PV-C07: Verdict precedence and the mixed-results rule (D11) hold on fixtures with several tests
- PV-C08: The red-green outcomes table maps every row to its result on fixture reports from each v1 runner
- PV-C09: Only assertion failures and missing new symbols count as red; import, collection and setup errors never do
- PV-C10: Partial limits apply as specified and a partial PR is never Not applicable
- PV-C11: Listed dependency bots are Not applicable; agent bots on the agent list are always checked
- PV-C12: A language outside version 1 gives Not applicable with its reason, and its skip and focus markers are still flagged
- PV-C13: The truedone.yml reader accepts the five keys, ignores and names unknown keys, and needs no YAML library
- PV-C14: proofline imports core for its forbidden-pattern and weakening checks, and its own tests still pass
- PV-C15: No verdict, reason or summary template contains the words safe or correct, or addresses the PR's author
- PV-W01: truedone.pages.dev/owner/repo/pull/n renders the static verdict in the browser, using only api.github.com
- PV-W02: The site has no server-side code except the token exchange, which stores nothing
- PV-W03: On GitHub's rate-limit response the page offers sign-in instead of failing, and a page uses at most 10 API calls for a PR under the static limits
- PV-W04: PR content is rendered as text only and the content security policy is set (S7)
- PV-W05: Every page shows the next rung, and says that red-green on someone else's PR executes that PR's code
- PV-W06: Static verdict p50 under 2 s and p95 under 5 s, measured on 100 corpus PRs
- PV-L01: npx truedone runs from a single published file with no dependencies
- PV-L02: The CLI implements the command table and exit codes
- PV-L03: On someone else's PR, --run executes nothing without a typed yes or --yes
- PV-L04: Static CLI p50 under 2 s and p95 under 4 s, measured
- PV-L05: The CLI and plugin restore the working tree exactly after a base swap, including after a killed run (S1)
- PV-L06: Someone else's PR runs with the filtered environment (S4)
- PV-L07: init writes the snippet by the stated rule and never edits existing lines
- PV-P01: The plugin is one Stop hook file with core bundled and no network calls
- PV-P02: The plugin blocks in exactly the three blocking cases of the plugin table and in no other
- PV-P03: A refactor with no test is never blocked and is shown once to the user
- PV-P04: /plugin marketplace add Truedone/truedone, then /plugin install truedone@truedone, installs the plugin on Claude Code 2.1.275 or later
- PV-P05: The plugin never blocks more than three times in a row
- PV-A01: The app verifies webhook signatures in constant time and handles each delivery once
- PV-A02: The app requests exactly checks write, pull requests write, contents read, actions read and metadata read
- PV-A03: The app labels a PR from its static result with p50 at most 3 s and p95 under 15 s, measured from GitHub's events, and its own time to the label is under 1.5 s at p50, measured from its phase line (D37)
- PV-A04: Exactly one truedone label is on a PR at any time, and the check run is updated in place
- PV-A05: The app matches a workflow run to its PR by head SHA and head repository, so fork PRs work
- PV-A06: The app accepts a report only for the PR's current head SHA, a truedone step matching the default branch or a published release, and the truedone.report/1 shape within its caps
- PV-A07: No report can override the app's own Tampered or Test changes: review
- PV-A08: The app never executes repository code and never uses pull_request_target
- PV-A09: Secrets exist only as Worker secrets; the repository and the lanes' machines hold none (S5)
- PV-A10: Logs hold no diff content, file contents or PR text (S8)
- PV-A11: The posting switch stops all posting within one minute, and enabled: false stops it per repository
- PV-X01: The action is one uses: line, runs on the runner's Node and installs nothing
- PV-X02: The action runs base twice and head three times, only for changed tests, with the swap in place and an exact restore (D7, S2)
- PV-X03: The action writes one truedone.report/1 artifact per job without a write token
- PV-X04: Red-green adds p50 under 60 s and p95 under 4 min inside an existing job, measured
- PV-X05: Coverage uses the D8 mechanism and the report names the condition used
- PV-X06: Runner detection finds vitest, jest, mocha, node --test and pytest from the nearest manifest that names a runner, with no config line, from files or from manifests passed as data, and the truedone.yml test key overrides it
- PV-G01: The corpus job samples PRs by D12 and publishes its sample list and code
- PV-G02: Gates 1, 2 and 4 are computed by a script in tools/corpus that anyone can re-run
- PV-G03: Gate 3 review sheets exist for 200 flags with at least 50 Tampered, and the human verdicts are recorded
- PV-G04: The red-green gates run on 200 PRs and record missed red and false Proven
- PV-G05: Each release has a recorded go or stop from Ryan, against its gates
- PV-G06: Gate 5 outreach to ten maintainers is sent by Ryan in week 2 and their installs are recorded by the end of week 6
- PV-I01: The index is produced weekly by a scheduled job from the corpus, never from visitors' pages
- PV-I02: Index #1 is static only, and red-green columns appear only after the red-green gates pass
- PV-I03: The index has a published method, data and corrections log
- PV-R01: LICENSE, SECURITY.md, the privacy note and the terms exist before the app is offered
- PV-R02: Releases use npm trusted publishing with provenance and need Ryan's approval
- PV-R03: The action is mirrored to Truedone/truedone-action on release with a single root action.yml
- PV-R04: Monitoring and alerts cover webhook errors, queue age and label latency
- PV-R05: The load test at 1,000 installs' volume ran and its cost is published
- PV-R06: Uninstall deletes the installation's stored data within 24 hours
- PV-B01: truedone's CI re-runs every task's criteria from the default-branch contract, and branch protection requires it (D22)
- PV-N01: The npm name, the repository Truedone/truedone and the Cloudflare Pages project truedone are registered
- PV-N02: The lanes hold no GitHub credential; only the lead runner pushes branches and opens pull requests, with Ryan's login, and every pull request passes the CI gate
- PV-D01: Every section of docs/spec.md, the decisions and the requirements list excepted, has a design document with a Mermaid flow diagram and a Mermaid schematic, joined in one master schematic (D29)
- PV-D02: docs/DEPENDENCY-MAP.md puts every file in a node, and a change to a node includes every node it must update; every task checks it (D28)
- PV-D04: The repository carries contributing, conduct, notice, changelog and issue and pull request templates, its settings name the homepage and topics, and its dependency map is readable as well as checked (D31)
- PV-D03: README.md has a summary of at most 60 words, one flow diagram and a quick start of one to five steps, and a second lane ran the quick start and reviewed it (D30)
