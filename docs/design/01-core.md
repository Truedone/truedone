# 01 core

Source section: core

core is two pure functions in one ES module, with no I/O. `analyse(input)` runs the static checks only and returns a Result. `judge(staticResult, reports)` takes that static result and adds the red-green reports.

The input holds the PR's files in the shape of the GitHub PR files API (path, status, previous path, patch, and base and head contents), the PR's title, body and author, and two optional fields: the published truedone action SHAs (D18) and the limits on files, lines and fetched files. Base and head contents are given only for test, setup, runner-config and workflow files.

The Result has the schema `truedone.verdict/1`. It holds one verdict, a label or null, a `partial` flag, the reasons (one line each, at most 10 shown) and `next`, which says what would change the verdict.

The starting code is in proofline: `src/forbidden.mjs`, `src/checks.mjs`, `src/infer.mjs` and `src/hook-stop.mjs`. That code reads git and the file system, so it is ported to pure functions, not copied. proofline has no runtime dependencies today.

## Flow

```mermaid
flowchart TD
  IN["input: files, pr, releases?, limits?"] --> AN["analyse(input): static checks only"]
  AN --> SR["static Result"]
  SR --> JU["judge(staticResult, reports)"]
  REP["red-green reports"] --> JU
  JU --> RR["Result with red-green added"]
  SR --> OUT["schema truedone.verdict/1: verdict, label, partial, reasons, next"]
  RR --> OUT
```

## Schematic

```mermaid
flowchart LR
  subgraph INPUT["input"]
    direction TB
    F["files: path, status, previous_path?, patch?, base?, head?"]
    P["pr: title, body, author login and type"]
    RL["releases?: published truedone action SHAs, D18"]
    LM["limits?: files, lines, fetched"]
  end
  subgraph MOD["core: one ES module, no I/O"]
    direction TB
    AN["analyse(input) -> Result"]
    JU["judge(staticResult, reports) -> Result"]
  end
  subgraph RESULT["Result, schema truedone.verdict/1"]
    direction TB
    V["verdict: tampered, review, could_not_run, proven, proven_new, proven_weak, no_evidence, pending, unrun, not_applicable"]
    LB["label: string or null"]
    PT["partial: boolean"]
    RS["reasons: check, file, line?, message; at most 10 shown"]
    NX["next: what would change the verdict"]
  end
  subgraph PORT["proofline starting code, ported to pure functions"]
    direction TB
    S1["src/forbidden.mjs: skip, focus, timeout and assertion patterns"]
    S2["src/checks.mjs: TEST_FILE_RE, hunk parsing"]
    S3["src/infer.mjs: changed tests, runner commands, test-command changes"]
    S4["src/hook-stop.mjs"]
  end
  INPUT --> AN
  AN --> RESULT
  RESULT --> JU
  REP["reports"] --> JU
  JU --> RESULT
  PORT -.-> MOD
```

[Back to the master schematic](00-master.md)
