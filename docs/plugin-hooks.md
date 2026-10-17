# The Stop hook interface the plugin relies on

PLG-00 records here what Claude Code gives a Stop hook and what it does with the hook's answer. PLG-01 builds against this page. The facts come from the hooks reference, fetched as Markdown on 2026-10-17. Each one is then checked with the probe in `packages/cli/test/fixtures/probe-hook/` on the installed version. The probe's results are under "Probe" below.

Pages read:

- Hooks reference: https://code.claude.com/docs/en/hooks
- Hooks guide: https://code.claude.com/docs/en/hooks-guide
- Plugins reference: https://code.claude.com/docs/en/plugins-reference
- Environment variables: https://code.claude.com/docs/en/env-vars

## Input

A command hook gets one JSON object on stdin. The fields common to every event are:

- `session_id`
- `prompt_id`
- `transcript_path`
- `cwd`
- `scratchpad_dir` (2.1.257 or later)
- `permission_mode`
- `effort`
- `hook_event_name`

A Stop hook also gets four fields of its own:

- `stop_hook_active`: true when the turn is already continuing because a stop hook blocked.
- `last_assistant_message`: the text of Claude's final response in this turn.
- `background_tasks`: the tasks still in flight.
- `session_crons`: the scheduled wakeups of this session.

Stop does not fire on a user interrupt. A turn that ends on an API error fires StopFailure instead, and Claude Code ignores that hook's output.

The reference says the transcript file "is written asynchronously and may lag the in-memory conversation". It also says it "isn't guaranteed to include the final message at Stop time on all versions". The plugin therefore takes the agent's claim from `last_assistant_message`, never from the transcript. The probe records whether the turn's last tool call is already in the transcript when Stop fires (see "Probe").

## Blocking

A Stop hook blocks the turn from ending in one of two ways, and the turn continues with Claude reading the reason:

- It exits 0 and prints `{"decision": "block", "reason": "..."}`. `reason` is required with `decision`.
- It exits 2. Its stderr is then the reason, unless its stdout carries a blocking JSON decision, whose reason wins.

`hookSpecificOutput.additionalContext` also continues the turn. It is labelled "Stop hook feedback" rather than a hook error, and it goes through the same loop protections.

Exit codes for Stop:

- **0:** the stop goes ahead, unless the JSON printed blocks it. Stdout goes to the debug log, not the transcript.
- **2:** the turn continues. One exception: with nothing on stdout and a "file is missing" message such as `No such file or directory` on stderr, exit 2 counts as a non-blocking error.
- **Any other code, a hook that does not start, or invalid JSON:** a non-blocking error. The stop goes ahead.

So the plugin blocks only through exit 0 with the JSON decision. A crash of the hook, or a missing `node`, can then never block by accident.

## User-visible message

`systemMessage` is a universal JSON output field: a warning shown to the user. In `--output-format stream-json` output it can arrive as an informational message. The Stop section does not say that Stop discards it. The plugin uses it for findings that do not block (No red-green evidence, Test changes: review, and the stop after three blocks), so the spec's fallback of one extra block that asks the agent to state the finding is not needed.

## Timeout

The `timeout` field of a hook is in seconds. The default for a `command` hook is 600 on Stop, which is not one of the events with a lower default. A hook that reaches its timeout is cancelled and its output is discarded, so it renders no decision, and the stop goes ahead. The plugin sets its own `timeout` in `hooks/hooks.json` and keeps its runs well under it.

## The consecutive-block cap

Claude Code ends the turn anyway after stop hooks have continued it eight times in a row: "after stop hooks have continued the turn eight times in a row, Claude Code overrides the next block and ends the turn". The count resets each time Claude calls a tool. `CLAUDE_CODE_STOP_HOOK_BLOCK_CAP` changes the cap; 0 disables it. The hooks guide puts it as "after it blocks eight times in a row with no tool call from Claude in between". The plugin's own limit, `MAX_BLOCKS = 3` (PLG-01), sits under it, and the plugin counts its own blocks in `${CLAUDE_PLUGIN_DATA}`, so it does not depend on the cap.

## Plugin layout and variables

- The plugin's hooks file is `hooks/hooks.json`. It wraps the event map in a top-level `"hooks"` key; a file without that wrapper fails to load.
- `.claude-plugin/plugin.json` needs only `name`.
- Hook commands get these variables, both in the command string and in the environment:
  - `${CLAUDE_PLUGIN_ROOT}`: the installed version's directory. It changes when the plugin updates, so no state goes there.
  - `${CLAUDE_PLUGIN_DATA}`: `~/.claude/plugins/data/<id>/`, kept across updates and deleted on uninstall.
  - `${CLAUDE_PROJECT_DIR}`
- A hook process inherits Claude Code's environment, without the `OTEL_*` exporter variables.

## Probe

Tested with Claude Code 2.1.302 (native build, macOS), on 2026-10-17, with the probe in `packages/cli/test/fixtures/probe-hook/`. `run-probe.sh` gives one headless turn:

- `claude -p` on the smallest model, run with `env -i`, `--setting-sources project`, `--strict-mcp-config` and `--plugin-dir` set to a copy of the probe plugin.
- The turn runs one marked Bash command (`echo PROBE_<nonce>`), then answers `DONE <nonce>`.
- The hook is a shell script, `hooks/probe.sh`. It records the Stop input, the plugin variables and a copy of the transcript as it stood when Stop fired, then answers as `PROBE_MODE` says.
- The init event listed only the probe plugin and the built-in ones, and no MCP server.

User-visible message: field systemMessage
Last assistant message: field last_assistant_message
Last tool call in the transcript when Stop fires: yes

What each run showed:

| Run | Hook answer | Stop calls | Result |
|---|---|---|---|
| log | exit 0, nothing printed | 1 | The turn ended. The input had `background_tasks`, `cwd`, `effort`, `hook_event_name`, `last_assistant_message`, `permission_mode`, `prompt_id`, `session_crons`, `session_id`, `stop_hook_active` (false) and `transcript_path`. `last_assistant_message` was the final text, `DONE <nonce>` |
| message | exit 0, `{"systemMessage": ...}` | 1 | The turn ended. The stream-json output carried a `system` event of subtype `informational`, level `notice`, with content `Stop says: <message>` |
| exit2 | first call exit 2 with a reason on stderr, then exit 0 | 2 | The turn continued once: Claude answered with the word the reason asked for. The second call had `stop_hook_active` true |
| json | first call `{"decision": "block", "reason": ...}`, then nothing | 2 | The same as exit2 |
| always | `{"decision": "block", ...}` on every call | 9 | Eight continuations, each with `stop_hook_active` true. The ninth block was overridden and the turn ended, matching the cap of eight |
| timeout5 | `timeout` 5 in hooks.json; the hook sleeps 30 s, then would block | 1 | The hook was cancelled. Its block never applied, and the turn ended 10 s after it started |
| timeout-default | no `timeout` in hooks.json; the hook sleeps 700 s, then would block | 1 | The hook was cancelled 600 s after it started. Its block never applied, and the turn ended, 605 s after the turn began |

The transcript copies from all 15 Stop calls held the turn's Bash `tool_use`, its `tool_result` and the final text. So on this version, when Stop fires, the transcript is current up to the last tool call and the final message. Transcript rows have `type` `assistant` or `user`, and `message.content` is a list. A tool call is an item of type `tool_use` with `name` and `input` (Bash: `input.command`; Edit and Write: `input.file_path`).

The reference still warns that the transcript may lag on other versions. So the plugin takes the claim from `last_assistant_message`. It reads tool-call order from the transcript only when the transcript already holds that final message, and otherwise case 3 does not block.

For a plugin loaded with `--plugin-dir`, `CLAUDE_PLUGIN_ROOT` was the plugin directory and `CLAUDE_PLUGIN_DATA` was `~/.claude/plugins/data/<name>-inline`. `CLAUDE_PROJECT_DIR` was the session's directory.
