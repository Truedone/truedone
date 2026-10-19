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

