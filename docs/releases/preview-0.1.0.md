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
