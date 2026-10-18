# truedone

`npx truedone` reads the current branch against the merge-base with the default branch and prints what the diff
shows about its tests. `npx truedone <PR link>` does the same for a pull request through the GitHub API, with
`GITHUB_TOKEN` if it is set; nothing is cloned. `--json` prints the `truedone.verdict/1` result, and
`--fail-on <verdicts>` exits 1 when the verdict is one of them. `npx truedone init` adds three lines for coding
agents to `AGENTS.md` or `CLAUDE.md`.

Exit codes: 0 when a verdict is produced or `--help` (or `-h`) prints the usage, 1 when `--fail-on` matches, 2 for a usage error, 3 for an internal error.

This is the 0.1.0 preview: `npx truedone --version` prints `truedone 0.1.0 (preview)`, and `--help` ends by naming it a preview.

The package is one file with no dependencies. Licence: Apache-2.0.
