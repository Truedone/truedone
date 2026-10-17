# 02 Checks and verdicts

Source section: Checks and verdicts

Each changed file gets one class, and the first rule that matches wins: Truedone config, Workflow, Runner config, Setup file, Test file, Test helper, Lockfile, Dependency manifest, Docs, and Source for everything else. JavaScript config files are never evaluated: defaults apply and the summary says so. Custom `testMatch` or `python_files` patterns are read from JSON, INI and TOML configs.

Checks run per test, matched by name. They replace proofline's net count of assertion lines per file. Each check gives a verdict: Tampered, Test changes: review, No red-green evidence, Tests changed: not run, Not applicable, or no finding for a test moved or renamed. A PR body that says tests were added, with no test file changed, is a reason line on No red-green evidence and never a verdict alone.

Equivalent means the same test on head has at least as many assertion calls as on base, and none moved down the weakening list. Node's assert.equal, strictEqual, deepEqual and deepStrictEqual go down to assert.ok or a bare assert; `pytest.skip()`, `this.skip()` and `t.skip()` in a test body are skips; and an assertion does not count when it is commented out, compares two literals, follows an unconditional return, sits under if (false) or if (0), or is inside a try whose catch does not rethrow. Such a hollowed test passes on base, so red-green gives it No red-green evidence, never Proven; the static check labels it Tampered. judge() and the runner share one red-green table, outcome() in packages/core/src/outcome.mjs. A test without two base runs and three head runs is Could not run, "incomplete runs", never No red-green evidence, and runner rows are keyed by test file and test name, so a hung base run pairs with its head runs and a same-named test in another file stays apart.

Red-green runs each test twice on base and three times on head. The first row of the outcome table that matches gives the result for that test. Failing by assertion means `AssertionError`, Node's `ERR_ASSERTION`, or a jest or vitest matcher failure. A missing symbol means `ImportError`, `ModuleNotFoundError`, `AttributeError`, `ReferenceError` or "is not a function", naming a symbol the diff adds. Any other import, collection or setup error is never red.

Each finding gives one reason line: `check` is its row's key (skip, focus, weakened, deleted, snapshot, parametrised, timeout, runner_config, step_release, step, claim, no_test, unrun, not_applicable), `file` the changed file, and a one-line `message` that names the test or the file. analyse() returns at most 10, in row order then path order, with the partial line kept as the last; the claim line comes only with No red-green evidence. judge() returns the whole Result: the label, `partial` from the static result, `next`, and one `red_green` line per test of the report that counts, naming its result, reason and coverage condition, a `report` line for each other report, or a `could_not_run` line for a report that ran no test; the static lines follow, at most 10 in all.

## Flow

```mermaid
flowchart TD
  F["changed file"] --> K["file class: the first rule that matches wins"]
  K --> CH["checks run per test, matched by name"]
  CH --> SV["each check gives its verdict"]
  CH --> RG["red-green per test: base two runs, head three runs; the first row that matches wins"]
  RG --> R1{"base: both fail by assertion; head: all pass, and the coverage condition D8 holds"}
  R1 -->|yes| P1["Proven"]
  R1 -->|no| R2{"base: both fail only because a symbol the diff adds is missing; head: all pass, and an assertion line names that symbol or a variable assigned from it"}
  R2 -->|yes| P2["Proven (new behaviour)"]
  R2 -->|no| R3{"base: either of the two rows above; head: all pass, condition not met"}
  R3 -->|yes| P3["Proven (weak)"]
  R3 -->|no| R4{"base: both pass; head: all pass"}
  R4 -->|yes| N1["No red-green evidence"]
  R4 -->|no| R5{"base: one fails and one passes"}
  R5 -->|yes| C1["Could not run: flaky on base"]
  R5 -->|no| R6{"head: one or two pass"}
  R6 -->|yes| C2["Could not run: flaky on head"]
  R6 -->|no| R7{"head: none pass"}
  R7 -->|yes| N2["No red-green evidence, reason: fails on head"]
  R7 -->|no| R8{"base: fails with any other error"}
  R8 -->|yes| C3["Could not run: errored, with the error type"]
  R8 -->|no| R9{"a run exceeds 5 minutes"}
  R9 -->|yes| C4["Could not run: timed out"]
```

## Schematic

```mermaid
flowchart LR
  subgraph CLASSES["file classes, in rule order"]
    direction TB
    C1["Truedone config: .github/truedone.yml"]
    C2["Workflow: .github/workflows/*.yml and *.yaml"]
    C3["Runner config: jest, vitest, vite and mocha configs, pytest.ini, tox.ini, setup.cfg, the pytest table of pyproject.toml, scripts.test and jest in package.json"]
    C4["Setup file: conftest.py, jest.setup, vitest.setup, setup-tests, and files named in setupFiles, setupFilesAfterEnv or mocha require"]
    C5["Test file: JS and TS *.test.*, *.spec.*, under test/, tests/ or __tests__/; Python test_*.py, *_test.py, under tests/"]
    C6["Test helper: non-test files under a test directory, fixtures, __snapshots__/, *.snap"]
    C7["Lockfile"]
    C8["Dependency manifest"]
    C9["Docs"]
    C10["Source: everything else"]
    C1 --> C2 --> C3 --> C4 --> C5 --> C6 --> C7 --> C8 --> C9 --> C10
  end
  subgraph CHECKS["checks, per test, matched by name"]
    direction TB
    K1["skip or disable added to a test that exists at base"]
    K2["focus added"]
    K3["assertion removed from, or weakened in, a test that exists at base, with no equivalent"]
    K4["test deleted, its normalised body found nowhere in head"]
    K5["test moved or renamed: the same body after removing whitespace and comments"]
    K6["snapshot updated; a parametrised case removed"]
    K7["timeout raised, in a test or runner config"]
    K8["runner config, setup file, test script or workflow changed, other than the truedone step"]
    K9["truedone step re-pinned to a published truedone release"]
    K10["truedone step removed, edited or pinned to any other SHA"]
    K11["PR body says tests were added, and no test file changed"]
    K12["source changed and no test file changed"]
    K13["test files changed, nothing above, no report"]
    K14["docs, a lockfile or dependency-manifest change, a listed bot, a pure rename, or a workflow change that touches no test and not the truedone step"]
  end
  EQ["equivalent: at least as many assertion calls on head as on base, and none moved down the weakening list"]
  WL["weakening list: toBe, toEqual, toStrictEqual down to toBeDefined, toBeTruthy, not.toBeNull, toBeTypeOf; assert x == y down to assert x; assertEqual down to assertTrue or assertIsNotNone"]
  TA["Tampered"]
  RV["Test changes: review"]
  NF["No finding"]
  NE["No red-green evidence"]
  UN["Tests changed: not run"]
  NA["Not applicable"]
  CLASSES --> CHECKS
  WL --> EQ
  EQ --> K3
  K1 --> TA
  K2 --> TA
  K3 --> TA
  K10 --> TA
  K4 -->|source it imported still exists| TA
  K4 -->|that source deleted too| RV
  K5 --> NF
  K6 --> RV
  K7 --> RV
  K8 --> RV
  K9 --> RV
  K11 -.->|a reason line only| NE
  K12 --> NE
  K13 --> UN
  K14 --> NA
```

[Back to the master schematic](00-master.md)
