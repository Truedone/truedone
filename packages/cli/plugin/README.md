# truedone for Claude Code

This plugin adds one Stop hook to Claude Code. When the agent ends a turn, the hook checks the changed tests and the
agent's claim about them. It blocks the stop only when a changed test fails, a test was weakened or disabled, or the
agent says the tests pass without having run them since its last file edit.

## Installing

In Claude Code, add the marketplace, then install the plugin from it:

```
/plugin marketplace add Truedone/truedone
/plugin install truedone@truedone
```

## When it runs

Claude Code runs the hook each time the agent finishes a turn: the `Stop` event in `hooks/hooks.json`, with a timeout of
600 seconds. A turn you interrupt does not run it. The hook is one file, `hooks/stop.mjs`, run with `node`.

## What it reads

- The Stop input Claude Code gives the hook: the session id, the working directory, the transcript path and the agent's
  last message.
- The session transcript, for the order of the tool calls in it: file edits, and shell commands that ran tests.
- The git repository in the working directory: the current branch and the working tree, untracked files included,
  against the merge-base with the default branch (the target of `origin/HEAD`, else `main`, else `master`).
- The manifests that name each changed test's runner (`package.json`, `pyproject.toml`, `pytest.ini`, `setup.cfg`), and
  `.github/truedone.yml`.

With no change against that merge-base, the hook stops there and answers nothing.

## Commands it starts

- `git`, which only reads: `rev-parse`, `symbolic-ref`, `merge-base`, `diff`, `ls-files`, `show`, `log` and
  `config user.name`. It runs git with an argument list, never through a shell.
- The changed test files, once a turn, on the working tree as it is, through `sh -c` in the directory of the manifest
  that names the runner, with the session's environment, and stopped after 120 seconds. The command is one of:
  - `node --test`
  - `npx --no -- vitest`, `npx --no -- jest`, `npx --no -- mocha` or `npx --no -- tsx --test`. `npx --no` runs the
    project's installed binaries and never downloads a package.
  - `python3 -m pytest`
  - the command that `test:` sets in `.github/truedone.yml`, when it sets one.

  Each run writes its report to a file named `.truedone-report-<tag>` in that directory, and the hook deletes the file
  once it has read it.

## Network

The hook makes no network request. The tests it runs are the project's own, so they reach the network only when they
are written to.

## What it stores

One small JSON file per session, at `${CLAUDE_PLUGIN_DATA}/sessions/<session id>.json`, or in `truedone-plugin` under the
system's temporary directory when `CLAUDE_PLUGIN_DATA` is not set. It holds how many times in a row the hook has
blocked, a hash of the last change and its findings, and the last 50 findings it has shown. The hook keeps nothing else.

## When it blocks, and when it only tells you

It blocks the stop in three cases, and the agent then reads the reason and carries on:

- a changed test fails on the fresh run;
- a test was weakened or disabled (Tampered);
- the agent's last message says the tests pass, but the changed tests have not run since its last file edit.

After three blocks in a row with no change since the last one, it lets the turn end and shows you the finding instead.

It shows you a finding without blocking, once for each change, when the analysis finds No red-green evidence, when the
changed tests could not run, or when a test change needs a look (Test changes: review).

The hook always exits 0 and blocks only through its JSON answer, so a crash, or a missing `node`, never blocks a turn.
When the check itself fails, it says so in one message.

## Turning it off

The hook reads no setting of its own. To turn it off, disable the plugin, and to remove it, uninstall it:

```
claude plugin disable truedone@truedone
claude plugin uninstall truedone@truedone
```

Uninstalling also deletes the plugin's data directory, and the session files in it, unless `--keep-data` is given.

## Licence

Apache-2.0, the licence of the repository (`LICENSE`).

## A wrong verdict

The wrong verdict form is at https://github.com/Truedone/truedone/issues/new?template=wrong-verdict.yml
