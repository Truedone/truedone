# The 0.1.0 preview

Each section is written by `node tools/release-preview.mjs <surface>` from what it measured (D35).

## The command line

Written by `node tools/release-preview.mjs cli`.

```text
$ npm pack packages/cli --json (empty npm config, HOME in a scratch directory)
tarball truedone-0.1.0.tgz, 36442 bytes, integrity sha512-w22AYpQN97QQvUzXlbdE5ZfMPwIUA598pV65DNJvlvGxw/Rw94e4UhRdfRp0tqG2wbGEIvHWgSzGlSWrkH+SkA==
  package/LICENSE 11358 bytes
  package/package.json 351 bytes
  package/README.md 2157 bytes
  package/truedone.mjs 111494 bytes
tarball check: pass (exactly the four files, version 0.1.0, none over 1048576 bytes, no secret pattern)
$ npm install --global --offline --prefix <scratch> truedone-0.1.0.tgz
$ truedone --version
truedone 0.1.0 (preview)
$ truedone https://github.com/Truedone/truedone-sandbox/pull/31 --json   -> tampered
$ truedone https://github.com/Truedone/truedone/pull/17 --json   -> review
$ truedone https://github.com/Truedone/truedone/pull/47 --json   -> no_evidence
$ truedone https://github.com/Truedone/truedone/pull/54 --json   -> unrun
$ truedone https://github.com/Truedone/truedone/pull/43 --json   -> not_applicable
result: pass
```

## The plugin

Written by `node tools/release-preview.mjs plugin`.

```text
$ claude --version
2.1.302 (Claude Code)
$ claude plugin marketplace add Truedone/truedone   (HOME in a scratch directory)
  ✔ Successfully added marketplace: truedone (declared in user settings)
$ claude plugin install truedone@truedone
  Installing plugin "truedone@truedone"...✔ Successfully installed plugin: truedone@truedone (scope: user)
installed: version 0.1.0, from Truedone/truedone on GitHub, at <scratch HOME>/.claude/plugins/cache/truedone/truedone/0.1.0
manifest version 0.1.0 (the release is 0.1.0)
manifest homepage https://truedone.pages.dev
Stop hook registered: node "${CLAUDE_PLUGIN_ROOT}/hooks/stop.mjs"
red-green in the hook: off (const REDGREEN_ENABLED = false;): this preview's hook has no red-green; it comes with PLG-03
$ node "${CLAUDE_PLUGIN_ROOT}/hooks/stop.mjs"   (sh -c, CLAUDE_PLUGIN_ROOT the installed copy, in a scratch repository on branch work: src/add.mjs and test/add.test.mjs changed, the test passing)
  on the recorded transcript of the plugin's case "row 3: the last message says tests pass, with no test run after the last edit: block", last message "All tests pass."
  -> {"decision":"block","reason":"truedone: the last message says the tests pass, but the changed tests have not run since the last file edit. Fix this, or say plainly in your reply that it is not fixed."}
the hook blocks with "have not run since the last file edit", as the plugin's own test expects
  on the recorded transcript of the plugin's case "row 3, not met: the claim follows a test run after the last edit: no block", last message "All tests pass."
  -> (nothing)
the hook lets the turn end and says nothing, as the plugin's own test expects
result: pass
```

## The publish

Ryan published the package from his terminal (D35). Read back on 2026-10-19T10:12:36Z, with an empty npm config:

```text
$ npm view truedone@0.1.0 version dist.integrity dist.shasum time maintainers dist-tags.latest repository.url
version 0.1.0
dist.integrity sha512-w22AYpQN97QQvUzXlbdE5ZfMPwIUA598pV65DNJvlvGxw/Rw94e4UhRdfRp0tqG2wbGEIvHWgSzGlSWrkH+SkA==
dist.shasum 25853bf7674fbf75d2c6f4dca898a728dd0f84e2
published 2026-10-19T09:05:07.151Z
maintainers optitransfer
dist-tags.latest 0.1.0
repository.url git+https://github.com/Truedone/truedone.git
$ npx -y truedone@0.1.0 --version   (HOME in a scratch directory)
truedone 0.1.0 (preview)
$ curl -s -o /dev/null -w '%{http_code}' https://api.github.com/apps/truedone   (no token)
200
```

npm's integrity is the one the command line section above checked, so the published package is that tarball.

## The action mirror

Written by `node tools/mirror-action.mjs <out dir>` from main's files; two runs give the same bytes, and each file's SHA-256:

```text
cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30  LICENSE
cba9d20ce94fdde27d4e901523663532c97f38fce7d5b45abc622a9843a0273a  NOTICE
90d18153fc02a3e592cb5768503db0cd2bed4222097895c1ad276ebd9385ca32  README.md
f926b87e27b37d4399ffd9167cf322b5126d200ed43060a983dd8905a4e3d04e  action.yml
c21b875fd85a9f4d66f19f589b6fb12ff2c8ca53d1ed60ac23aab87778f6322c  dist/index.mjs
```

The mirrored README's usage block reads the release tag:

```yaml
- uses: Truedone/truedone-action@v0.1.0
  # For production, pin the commit the tag names: Truedone/truedone-action@<40-hex commit sha>
```

Ryan pushes the tree and the tag with the commands the tool prints (REL-P5):

```text
$ node tools/mirror-action.mjs <out dir>
$ cd <out dir>
$ git init -b main && git add -A && git commit -m "truedone-action v0.1.0"
$ git remote add origin https://github.com/Truedone/truedone-action.git
$ git push -u origin main
$ git tag v0.1.0 && git push origin v0.1.0
```

## Acceptance

Each surface's install path, walked from a fresh home as a new user (REL-P4, D35): one row per surface, "| <surface> | <command> | <output> | <UTC time> | Works |" or the failure. Each output names the build it ran and its evidence, and says whether a GitHub token was used. A surface flips in packages/web/lib/release.mjs only with a Works row.

| Surface | Command | Output | UTC time | Result |
| --- | --- | --- | --- | --- |
| The site | `https://truedone.pages.dev/<owner>/<repo>/pull/<n>` for each of the five examples, read in headless Chrome (found by tools/check-browser.mjs) with `--dump-dom` and `--use-mock-keychain`, a fresh profile per page and HOME a fresh scratch directory | Build: the Pages deployment serving packages/web tree 645623b5603bdd58df41a300406f0080ffa93738 (main 3f51d6cbdd38f789354942d3f637a75f3389a0ec): all 74 served files equal that tree's byte for byte, read at 11:12:55Z before the walk and at 11:13:25Z after it; the deployment id is not on the served site. Evidence: each page reached data-state done, and its verdict badge, read back to its verdict through VERDICTS in packages/web/lib/view.mjs, gave Truedone/truedone-sandbox#31 tampered, Truedone/truedone#17 review, Truedone/truedone#47 no_evidence, Truedone/truedone#54 unrun, Truedone/truedone#43 not_applicable, from 11:12:55Z to 11:13:11Z, the five the notes give. Earlier walks without the mock keychain gave the same verdicts, except that the first Chrome launch in each new scratch home wrote no page within 90 seconds; none of them is counted here. Token: none; GitHub's anonymous quota for this address was 60 before the walk and 44 after. | 2026-10-19T11:12:55Z | Works |
| The command line | `npx -y truedone --version`, then `npx -y truedone <link> --json` on each of the five examples, with no version, as the README shows; HOME a fresh scratch directory and an empty npm config | Build: npm's truedone 0.1.0, dist-tags latest 0.1.0, published 2026-10-19T09:05:07Z, dist.integrity sha512-w22AYpQN97QQvUzXlbdE5ZfMPwIUA598pV65DNJvlvGxw/Rw94e4UhRdfRp0tqG2wbGEIvHWgSzGlSWrkH+SkA== (read with `npm view`), which is the integrity npx installed and the tarball's in "The command line" above. Evidence: `truedone 0.1.0 (preview)`; then, from 09:55:59Z to 09:56:14Z, Truedone/truedone-sandbox#31 tampered, Truedone/truedone#17 review, Truedone/truedone#47 no_evidence, Truedone/truedone#54 unrun, Truedone/truedone#43 not_applicable, the five the notes give. Token: GITHUB_TOKEN from `gh auth token`, as a developer with the gh CLI runs it. | 2026-10-19T09:55:42Z | Works |
| The GitHub App | The production App, slug truedone, installed by the owner on the organisation Truedone, all repositories; the sandbox pull request https://github.com/Truedone/truedone-sandbox/pull/746; each value read again with `gh api` (GET only) | Build: the production Worker's /health version 9845d2febae5ac31f7df7f1764defb012734df82, posting_enabled true, at 09:50Z and again at 09:56:49Z and 10:10:31Z. Evidence: check run 117989210254 of app slug truedone on head 8a4ed72d385dfadbde98370aaeb4ecedcebe95bd, title "truedone: unrun", conclusion neutral, completed 09:35:10Z; label event truedone:unrun, actor truedone[bot], at 2026-10-19T09:35:10Z. Core gives the same verdict: `GITHUB_TOKEN="$(gh auth token)" npx -y truedone https://github.com/Truedone/truedone-sandbox/pull/746 --json` printed verdict unrun, label truedone:unrun, at 09:52Z and again at 09:57:13Z. Installations, read with `gh api orgs/Truedone/installations`: installation 172971655 on the organisation Truedone, all repositories, created 2026-10-19T09:22:25Z, permissions actions read, checks write, contents read, metadata read and pull_requests write, events pull_request and workflow_run. The owner also installed it on his account mgillr; that installation cannot be listed with the token used here, so it is the owner's statement. The owner turned the production posting flag on at 08:52:30Z, before this row and before the installation, by his own decision (REL-W4), not after the sandbox row as this task's entry orders. Known fault APP-29: the development App, truedone-dev, took the action's red-green report on the same pull request, removed truedone:unrun at 09:35:36Z and set truedone:yes at 09:35:37Z, while the production App did not take that report, because it read the default branch's workflow through a cached branch address; the fix merged to main at 76dfcb882b1865b02cdaea6d4741e142febfedb2 after this walk and is not in this build. This row holds that the App's own check run and label equal core's verdict. Token: `gh auth token` (mgillr) for the reads and for core. | 2026-10-19T09:35:10Z | Works |
| The plugin | `claude plugin marketplace add Truedone/truedone`, then `claude plugin install truedone@truedone`, with claude 2.1.302 (Claude Code) under `env -u CLAUDECODE`, HOME and CLAUDE_CONFIG_DIR in a fresh scratch directory, no SSH agent and no SSH key | Build: version 0.1.0, installed commit b939b84f21ad9991ac9d828c7339fd269b79fecd (gitCommitSha in installed_plugins.json), main's head then, cloned from https://github.com/Truedone/truedone.git. Evidence: "Successfully added marketplace: truedone" and "Successfully installed plugin: truedone@truedone (scope: user)"; the installed hooks/stop.mjs, hooks/hooks.json, .claude-plugin/plugin.json and README.md equal that commit's packages/cli/plugin files byte for byte; the installed Stop hook, run as Claude Code runs it in a scratch repository, blocked on the plugin's recorded case "row 3" with "the changed tests have not run since the last file edit", and printed nothing on "row 3, not met", as the plugin's own tests expect. A first walk at 09:57:31Z, with the developer's SSH agent, cloned over SSH and installed commit 878a06ba5d0ef3b2d47185200b9a88ec60f73a31, main's head then, with the same results. Token: none. | 2026-10-19T10:03:32Z | Works |
| The action | `uses: Truedone/truedone-action@v0.1.0` in the sandbox's workflow | Could not run. Truedone/truedone-action is empty: `gh api repos/Truedone/truedone-action/git/refs` answers 409 "Git Repository is empty." (at 09:57:13Z and again at 11:14:08Z), the tag v0.1.0 answers the same, and the repository has no release. Its release is REL-P6, so its entry in release.mjs stays false. Token: `gh auth token` (mgillr) for the reads. | 2026-10-19T09:57:13Z | Could not run: Truedone/truedone-action is empty and has no v0.1.0 |
