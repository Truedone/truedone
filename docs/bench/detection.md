# Detection benchmark

Nine labelled pull requests from the research note of 2026-10-18, each a base tree and a head tree under
`tools/test/fixtures/detect/`, run through the real core and the red-green runner by `node tools/bench/detect.mjs`.
Beside each verdict is what baseline CI says: whether the head tree's own tests pass. The bench's check is a
contract criterion, so CI runs it on every change, and a change that flags the legitimate case cannot land.

6 of 9 cases detected, 2 not detected by design, 0 false alarms on 1 legitimate case; baseline CI is green on 8 of 9.

| Case | truedone | baseline CI | Detected | Why |
|---|---|---|---|---|
| an assertion is weakened while the tests still pass | Tampered | green | yes | expect(total).toBe(100) becomes a check that the total exists; the test runs and passes, and accepts any total |
| a failing test is skipped | Tampered | green | yes | the test that would fail is marked skip, so the suite stays green while the code accepts expired tokens |
| a source change with no relevant test | No red-green evidence | green | yes | the suite covers another module and still passes; nothing in the change is tested |
| a test that is green on both base and head | No red-green evidence | green | yes | the added test asserts behaviour the base already had, so it passes without the change and proves nothing about it |
| a test that is red-green yet asserts the wrong behaviour | Proven (weak) | green | no | the new test fails without the change and passes with it, so it is red-green evidence; truedone never checks the asserted value against the stated requirement, and here the test asserts the bug (SPK-02 measures a requirement evidence check) |
| a mock hides an integration failure | Proven (weak) | green | no | the test is red-green on the endpoint path, and its mocked provider accepts the payload the real one refuses (amount instead of amount_cents); truedone runs the pull request's own tests and never the integration |
| a plausible mutation the suite survives | No red-green evidence | green | yes | the change flips a boundary (more than ten becomes ten or more) and the suite checks 0 and 20 items only, so it passes with either comparison |
| a flaky test | Could not run | red | yes | the test fails on every even-numbered run, so one CI run passes or fails by its turn (the first run fails); truedone's three head runs see both outcomes and refuse to call the fix proven |
| a legitimate refactor of test structure that weakens nothing | Proven (weak) | green | no | nothing to detect: the moved tests keep their bodies and the fix is red on base and green on head |

A detected case is one whose verdict surfaces the weakness: Tampered, Test changes: review, No red-green evidence or Could not run.
The two by-design misses are the floor of what running a pull request's own tests can show: the test's asserted value is never checked
against the stated requirement (SPK-02 measures that check), and a mocked dependency is never exercised. The red-green verdicts read
Proven (weak) because the local run carries no coverage data; the action adds it. This bench is the regression floor, not the noise
claim: GATE-02 and GATE-03R measure noise on real pull requests, and each false alarm found there becomes a case here.
