# The TypeScript coverage spike

RUN-04's question: can V8 coverage through `NODE_V8_COVERAGE`, mapped through
source maps, say which changed TypeScript lines a test ran, with no added
dependency? Five public TypeScript repositories using vitest, each carrying a
D12 agent signal, were cloned and run inside the gate container by
`evidence/glm-run04-spike/spike.sh` (lead run 2026-10-18 05:56Z, rc 0).

## The repositories

| repository | toolchain | D12 signal |
|---|---|---|
| [wancup/wantools](https://github.com/wancup/wantools) | vitest 5.0.3, typescript 5.9.3 | [PR #1341](https://github.com/wancup/wantools/pull/1341) (Co-Authored-By trailer) |
| [mguinada/k-wiki](https://github.com/mguinada/k-wiki) | vitest 4.1.11, typescript 7.0.2 | [PR #476](https://github.com/mguinada/k-wiki/pull/476) (Co-Authored-By trailer) |
| [dvd117/visto-bueno](https://github.com/dvd117/visto-bueno) | vitest 5.0.5, typescript 6.0.2 | [PR #63](https://github.com/dvd117/visto-bueno/pull/63) (Generated with Claude Code body) |
| [zapatabautistad-coder/dentalflow](https://github.com/zapatabautistad-coder/dentalflow) | vitest 5.0.2, typescript 5 | [PR #75](https://github.com/zapatabautistad-coder/dentalflow/pull/75) (copilot-swe-agent author) |
| [ericthayer/screen-study](https://github.com/ericthayer/screen-study) | vitest 4.1.10, typescript 5.9.3 | [PR #5](https://github.com/ericthayer/screen-study/pull/5) (copilot-swe-agent author) |

## What was measured

The container ran each repository's first `.test.ts` under
`NODE_V8_COVERAGE=/out/<repo>/coverage` and wrote the coverage files, the
covered module and its decoded inline map. The lead's run of the same script
measured k-wiki alone at 3,096 script entries: 1,112 naming `node:`, 1,967
naming `node_modules`, and the remainder — the repository's own transformed
modules — carrying empty or opaque module ids that name no file in the
repository. The same shape held for every repository: the per-script
`lines.txt` translations all read "no covered module inside the repository was
found in the coverage output".

The reason is vitest's transform: TypeScript is transpiled in memory by
esbuild and served under a module id, not written beside the source, so the
V8 coverage entry's url does not name a file whose inline map can be decoded.
No repository enabled `sourceMap` in its tsconfig, and none of that changes
without adding a dependency or a custom transform, which the question forbids.

Node runners whose reports name files are unaffected: the direct
`node --test` path keeps working, which is what
`packages/core/test/run-coverage-js.test.mjs` proves on a live fixture.

## Decision: imports

V8 coverage through `NODE_V8_COVERAGE` cannot, with no dependency, name which
changed TypeScript lines a vitest test ran: the coverage entries for the
repository's own modules do not identify them. The condition falls back to
imports for transformed TypeScript — one hop from the test counts, two hops do
not. Python is unaffected: the plugin collector in
`packages/core/run/coverage.mjs` maps changed Python lines directly, which
`packages/core/test/run-coverage-py.test.mjs` proves on a live pytest fixture.

Decision: imports
