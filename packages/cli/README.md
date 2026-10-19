# truedone

`npx truedone` reads the current branch against the merge-base with the default branch and prints what the diff
shows about its tests. `npx truedone <PR link>` does the same for a pull request through the GitHub API, with
`GITHUB_TOKEN` if it is set; nothing is cloned. `--json` prints the `truedone.verdict/1` result, and
`--fail-on <verdicts>` exits 1 when the verdict is one of them. `npx truedone init` adds four lines for coding
agents to `AGENTS.md` or `CLAUDE.md`, and `npx truedone init --global` adds them to your own `~/.claude/CLAUDE.md` (and
`~/.codex/AGENTS.md` when `~/.codex` exists), so they apply in every repository you work in.

`--pr-line` prints one line for a pull request description: the verdict, its reason and the link to the verdict's
public page, which recomputes it for anyone who opens it. The fourth `init` line asks the agent to include it.

`npx truedone report <PR link>` prints a link to the wrong-verdict form on Truedone/truedone, filled with the pull
request, its commits, the verdict and the version. Nothing is sent until you submit the form.

## As a tool for agents (MCP)

`npx truedone mcp` serves the same check over the Model Context Protocol on stdio, as two tools:
`truedone_check_pr` (a pull request link) and `truedone_check_branch` (the current branch). Each answers with the
verdict line for a pull request description and the `truedone.verdict/1` result.

Claude Code:

```sh
claude mcp add truedone -- npx -y truedone mcp
```

Cursor (`.cursor/mcp.json`) and VS Code (`.vscode/mcp.json`, where the key is `servers`):

```json
{ "mcpServers": { "truedone": { "command": "npx", "args": ["-y", "truedone", "mcp"] } } }
```

Codex (`~/.codex/config.toml`):

```toml
[mcp_servers.truedone]
command = "npx"
args = ["-y", "truedone", "mcp"]
```

Exit codes: 0 when a verdict is produced or `--help` (or `-h`) prints the usage, 1 when `--fail-on` matches, 2 for a usage error, 3 for an internal error.

The package is one file with no dependencies. Licence: Apache-2.0.
