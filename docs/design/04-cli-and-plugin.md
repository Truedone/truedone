# 04 cli and plugin

Source section: cli and plugin

**The CLI.** `npx truedone` checks the current branch against the merge-base with the default branch, statically. Given a PR link or `owner/repo#n`, it checks statically through the API and clones nothing. `--run` adds red-green: on your own branch it runs at once; on anyone else's PR it clones to a temporary directory, says it will execute that PR's code, and waits for a typed `yes` or `--yes`. `--docker` runs red-green inside `node:24-slim` or `python:3.12-slim`. `--json` prints `truedone.verdict/1`. `--fail-on <verdicts>` exits 1 when the verdict is in the list. `init` adds the snippet to `AGENTS.md` if it exists, else to `CLAUDE.md` if it exists, else creates `AGENTS.md`; it never edits existing lines and prints what it wrote. Exit codes: 0 when a verdict is produced, 1 when `--fail-on` matches, 2 for a usage error, 3 for an internal error.

**The plugin.** A Claude Code plugin with one Stop hook, declared in `hooks/hooks.json` and run as `node "${CLAUDE_PLUGIN_ROOT}/hooks/stop.mjs"`: a single file with core bundled in. It makes no network calls and keeps any state in `${CLAUDE_PLUGIN_DATA}`. The truedone repository holds `.claude-plugin/marketplace.json`, so `/plugin marketplace add mgillr/truedone`, then `/plugin install truedone@truedone`, installs it (Claude Code 2.1.275 or later). It is also submitted to the official marketplace, after which `/plugin install truedone@claude-plugins-official` works.

The hook blocks when a test the agent added or changed fails on a fresh run, when a test was weakened or disabled (Tampered), or when the agent's last message claims tests pass and the changed tests were not run after its last file edit, judged from the transcript's tool-call order. It does not block for No red-green evidence (shown once to the user) or Test changes: review (shown to the user). After three blocks in a row with no change since the last one, it does not block: the agent stops and the finding is shown to the user. That limit of three sits under Claude Code's override of a Stop hook after eight blocks in a row with no tool call in between.

Before the plugin task starts, lane-b reads the hooks reference for the Stop hook's input fields (the transcript path), its exit-code behaviour and its user-visible message field, and records them in the task. If there is no user-visible field, a finding that does not block goes through one block whose reason asks the agent to state it, and never a second.

## Flow

```mermaid
flowchart TD
  subgraph CLI["npx truedone"]
    direction TB
    A{"what is checked"}
    A -->|no argument| BR["the current branch against the merge-base with the default branch, static"]
    A -->|"a PR link or owner/repo#n"| API["static, through the API, nothing cloned"]
    BR --> RUN{"--run?"}
    API --> RUN
    RUN -->|no| OUT["verdict"]
    RUN -->|yes| WHO{"whose code"}
    WHO -->|your own branch| RG["red-green at once"]
    WHO -->|"anyone else's PR"| CL["clone to a temporary directory and say it will execute that PR's code"]
    CL --> YES{"typed yes, or --yes?"}
    YES -->|yes| RG
    RG --> DK{"--docker?"}
    DK -->|yes| IMG["red-green inside node:24-slim or python:3.12-slim"]
    DK -->|no| OUT
    IMG --> OUT
    OUT --> JS{"--json?"}
    JS -->|yes| PJ["prints truedone.verdict/1"]
    OUT --> FO{"--fail-on lists the verdict?"}
    FO -->|yes| E1["exit 1"]
    FO -->|no| E0["exit 0"]
  end
  subgraph PLUGIN["Stop hook"]
    direction TB
    S["Claude Code runs node ${CLAUDE_PLUGIN_ROOT}/hooks/stop.mjs"] --> C{"case"}
    C -->|a test the agent added or changed fails on a fresh run| BL["block"]
    C -->|a test was weakened or disabled, Tampered| BL
    C -->|last message claims tests pass, changed tests not run after the last file edit| BL
    C -->|No red-green evidence| SH1["no block, shown once to the user"]
    C -->|"Test changes: review"| SH2["no block, shown to the user"]
    BL --> TH{"three blocks in a row with no change since the last one?"}
    TH -->|yes| ST["no block: the agent stops and the finding is shown to the user"]
  end
```

## Schematic

```mermaid
flowchart LR
  subgraph CLIP["CLI"]
    direction TB
    CMDS["npx truedone, with a PR link or owner/repo#n"]
    FLAGS["--run, --docker, --json, --fail-on"]
    INIT["init: snippet into AGENTS.md, else CLAUDE.md, else a new AGENTS.md"]
    EXIT["exit codes: 0 verdict, 1 --fail-on match, 2 usage error, 3 internal error"]
  end
  subgraph PLUG["plugin"]
    direction TB
    HJ["hooks/hooks.json: one Stop hook"]
    SM["hooks/stop.mjs: a single file with core bundled in, no network calls"]
    DATA["state in ${CLAUDE_PLUGIN_DATA}"]
    HJ --> SM
    SM --> DATA
  end
  subgraph REPO["truedone repository"]
    MK[".claude-plugin/marketplace.json"]
  end
  CORE["core"]
  CC["Claude Code 2.1.275 or later: overrides a Stop hook after eight blocks in a row with no tool call in between"]
  OFF["official marketplace: truedone@claude-plugins-official"]
  GH["GitHub API"]
  IMGS["node:24-slim or python:3.12-slim"]
  CORE --> CLIP
  CORE --> SM
  MK -->|"/plugin marketplace add mgillr/truedone, then /plugin install truedone@truedone"| CC
  OFF -.->|after submission| CC
  CC -->|Stop event| HJ
  SM -->|at most three blocks in a row| CC
  CMDS -->|"PR link: static, nothing cloned"| GH
  FLAGS -->|"--docker"| IMGS
```

[Back to the master schematic](00-master.md)
