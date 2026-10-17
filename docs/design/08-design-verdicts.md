# 08 Verdicts

Source section: From the design: verdicts

Every PR gets exactly one verdict, chosen by precedence. Every verdict except Not applicable sets a label, so a maintainer can filter the PR list without reading anything. The check conclusion is neutral by default, so it never blocks a merge unless the maintainer turns that on. A large PR that was only partly analysed gets "(partial)" after its verdict.

The ten verdicts, highest precedence first, with their labels: Tampered (`truedone:tampered`), Test changes: review (`truedone:review`), Could not run (`truedone:could-not-run`), Proven (`truedone:yes`), Proven (new behaviour) (`truedone:yes`), Proven (weak) (`truedone:weak`), No red-green evidence (`truedone:no-evidence`), Waiting for approval (`truedone:pending`), Tests changed: not run (`truedone:unrun`), and Not applicable, which has no label. Tampered, Test changes: review, Tests changed: not run and Not applicable come from the diff alone. No red-green evidence does when no test file changed. Waiting for approval comes from GitHub's run status. The others need a run.

Could not run applies only when no test reached a result. When several tests ran, the best result of any test stands and the others are listed.

A verdict states what was observed about the change. It never says "safe" or "correct" and never addresses the author.

What to do next, which is also the Result's `next`, and what truedone.pages.dev/why shows for each label:

- Tampered: Restore an equivalent test, or pin the step to a published release.
- Test changes: review: Confirm the test change is intended.
- Could not run: Fix the named reason and run again.
- Proven: Review the rest of the change as usual.
- Proven (new behaviour): Review the rest of the change as usual.
- Proven (weak): Make the test run the changed lines and assert on them.
- No red-green evidence: Add a test that fails before the change and passes after it.
- Waiting for approval: Approve the run on GitHub.
- Tests changed: not run: Run the changed tests: the next rung.
- Not applicable: Nothing.

## Flow

```mermaid
flowchart TD
  PR["a PR"] --> T{"a test that existed at base is disabled, focused or weakened with nothing equivalent added, or the truedone step is removed, edited or re-pinned other than to a published release?"}
  T -->|yes| VT["Tampered"]
  T -->|no| RV{"tests moved, removed or rewritten in a way that may be legitimate, a raised timeout, a runner config, setup file, test script or truedone-step workflow change, or the step moved to a newer published release?"}
  RV -->|yes| VR["Test changes: review"]
  RV -->|no| CN{"no test reached a result?"}
  CN -->|yes| VC["Could not run, with the reason named"]
  CN -->|no| P{"a test fails on base by assertion twice, passes on head three times out of three, and runs lines the PR changed?"}
  P -->|yes| VP["Proven"]
  P -->|no| PN{"a test fails on base only because a function or module the PR adds does not exist yet, passes on head three of three, asserts on that new code's result, and runs changed lines?"}
  PN -->|yes| VPN["Proven (new behaviour)"]
  PN -->|no| PW{"red-green holds, but the test runs none of the changed non-test lines or asserts nothing about them?"}
  PW -->|yes| VPW["Proven (weak)"]
  PW -->|no| NE{"source changed, and no test in the PR fails without the change?"}
  NE -->|yes| VNE["No red-green evidence"]
  NE -->|no| WA{"tests changed, the repository has the truedone step, and GitHub holds the run for a first-time contributor?"}
  WA -->|yes| VWA["Waiting for approval, static findings shown meanwhile"]
  WA -->|no| UN{"tests added or changed with nothing weakened, and no red-green has run?"}
  UN -->|yes| VUN["Tests changed: not run"]
  UN -->|no| NA{"docs only, a lockfile or dependency change, a dependency or release bot, a CI-only change that touches no test and not the truedone step, a pure rename, or a language version 1 does not support?"}
  NA -->|yes| VNA["Not applicable, no label"]
  VT --> PA{"only partly analysed?"}
  VR --> PA
  VC --> PA
  VP --> PA
  VPN --> PA
  VPW --> PA
  VNE --> PA
  VWA --> PA
  VUN --> PA
  PA -->|yes| PS["(partial) after the verdict"]
```

## Schematic

```mermaid
flowchart LR
  subgraph DIFF["from the diff alone"]
    direction TB
    T["Tampered"] --> LT["truedone:tampered"]
    R["Test changes: review"] --> LR["truedone:review"]
    U["Tests changed: not run"] --> LU["truedone:unrun"]
    NA["Not applicable"] --> LNA["no label"]
  end
  subgraph DIFFIF["from the diff alone when no test file changed"]
    direction TB
    NE["No red-green evidence"] --> LNE["truedone:no-evidence"]
  end
  subgraph RUN["need a run"]
    direction TB
    C["Could not run"] --> LC["truedone:could-not-run"]
    P["Proven"] --> LP["truedone:yes"]
    PN["Proven (new behaviour)"] --> LP
    PW["Proven (weak)"] --> LW["truedone:weak"]
  end
  subgraph GH["from GitHub's run status"]
    direction TB
    W["Waiting for approval"] --> LWA["truedone:pending"]
  end
  CONC["check conclusion: neutral by default; blocks a merge only when the maintainer turns that on"]
  WORD["wording rule: states what was observed; never safe or correct; never addresses the author"]
  PART["(partial) after the verdict of a large PR only partly analysed"]
  DIFF --> CONC
  DIFFIF --> CONC
  RUN --> CONC
  GH --> CONC
  WORD -.-> DIFF
  WORD -.-> DIFFIF
  WORD -.-> RUN
  WORD -.-> GH
  PART -.-> CONC
```

[Back to the master schematic](00-master.md)
