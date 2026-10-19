# The requirement evidence spike

SPK-02's question: BENCH-01 case 05 is a bad test that agrees with a bad implementation. Its new test asserts that an
expired token is accepted, the change makes `isValid` accept every token, and both ordinary CI and red-green are green.
Can a check that ties each test's expected result to an acceptance criterion the pull request states catch that case,
without false ties on the legitimate ones? `tools/spikes/requirement.mjs` is the prototype. `node
tools/spikes/requirement.mjs` writes `docs/spikes/requirement-data.jsonl`, one line per case, and every number below is
read from that file. Mutation checks are RUN-05's and are not part of this spike.

## What the prototype does

It reads text only: it runs no test, spawns nothing and uses no network.

- **Criteria.** From the pull request body, and from a `REQUIREMENTS.md` in the head tree in the `- ID: text` form
  docs/spec.md names. A criterion is stated only by a marker: an inline `Requirement:` or `Acceptance criteria:` (the
  sentence after the colon), a list under a heading or lead-in line naming requirements or acceptance criteria, or a
  `- ID: text` line. A description of the change is not a criterion. A case with no marker gets no criterion, and its
  line says so. `requirements.txt` is a dependency manifest by the spec's file classification and is never read. A
  linked issue (`Fixes #12`) is recorded, but its text is not read.
- **Tests.** Every test in a test file the pull request adds or modifies, on head, in JavaScript (`test`, `it`) and
  Python (`def test_*`).
- **Score.** A test's subject is the words of its name; its outcome is the side its assertions expect (a predicate such
  as `isValid` asserted true or false, or an expected throw), or its name's side when no assertion names one. It is
  **tied** when its name shares at least two of a criterion's subject words (all of them, when the criterion has fewer)
  and its outcome does not oppose the criterion's. When the words match and the outcome is the opposite one, it is
  **untied** with the finding `contradicts`. Every other test is untied, with the reason.
- **Labels.** Each scored test carries a hand label (tied, contradicts or untied) from reading the case, so the false
  ties and the misses are counted, not judged.

## The cases

The nine BENCH-01 cases under `tools/test/fixtures/detect/`, and the one sandbox case this repository records:
`packages/app/test/fixtures/sandbox-42`, Truedone/truedone-sandbox#42 as recorded on 2026-10-18 before the move to the
organisation (its body, its file list, and the base and head text of `python/tests/test_calc.py`). Sandbox #31 is named
in `docs/releases/preview-0.1.0.md` and `packages/web/why.html` only by its verdict and one line, with no body or files
committed, so it is not run. The DEMO-01 cases are not committed yet.

## The numbers

| Case | Kind | Criteria stated | Tests scored | Tied | Untied | Of which contradicts | False ties | Misses |
|---|---|---|---|---|---|---|---|---|
| 01-assertion-weakened | tampering | 0 | 1 | 0 | 1 | 0 | 0 | 0 |
| 02-failing-test-skipped | tampering | 0 | 2 | 0 | 2 | 0 | 0 | 0 |
| 03-source-change-no-test | no_evidence | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| 04-green-on-base-and-head | no_evidence | 0 | 2 | 0 | 2 | 0 | 0 | 0 |
| 05-red-green-wrong-assertion | by_design | 1 | 2 | 0 | 2 | 1 | 0 | 0 |
| 06-mock-hides-integration | by_design | 0 | 1 | 0 | 1 | 0 | 0 | 0 |
| 07-mutation-survives | no_evidence | 0 | 3 | 0 | 3 | 0 | 0 | 0 |
| 08-flaky-test | could_not_run | 0 | 1 | 0 | 1 | 0 | 0 | 0 |
| 09-legitimate-test-refactor | legitimate | 0 | 2 | 0 | 2 | 0 | 0 | 0 |
| sandbox-42 | probe | 0 | 3 | 0 | 3 | 0 | 0 | 0 |
| All ten | | 1 | 17 | 0 | 17 | 1 | 0 | 0 |

A false tie is a test scored tied that its label does not tie. A miss is a test labelled tied and scored untied, or
labelled contradicts and not found contradicting. No criterion was invented (0 in all ten cases) and no test was found
contradicting a criterion its label does not (0 false contradictions).

**Does the wrong-assertion case separate from the legitimate ones?** On the tied and untied counts, no. Case 05 has 0
tied tests of 2, the same as the legitimate refactor 09 (0 of 2) and sandbox #42 (0 of 3); all 17 scored tests in the
ten cases are untied, 15 of them because their case states no criterion. On the `contradicts` finding, yes, once: case 05's new
test, "an expired token is accepted", shares "expired" and "tokens" with the stated criterion "expired access tokens are
rejected", and its assertion expects `isValid({ expires: 10 }, 20)` to be true, the accepting side where the criterion
states the refusing one. It is the only test of the 17 found contradicting a criterion. The other test in case 05, "a
live token is accepted", shares only "tokens" by its name and stays untied.

What each reading would do as a verdict class, from the same rows:

| Rule | Cases flagged | Case 05 flagged | Legitimate cases flagged (09, sandbox #42) |
|---|---|---|---|
| a scored test is untied | 9 of 10 (every case with a scored test) | yes | 2 of 2 |
| a test contradicts a stated criterion | 1 of 10 | yes | 0 of 2 |

On the test's six fixture cases (`tools/test/fixtures/requirement/`: criteria inline in the body, in a list under an
acceptance heading and in a `REQUIREMENTS.md`, and one case with none), it ties 6 of 12 tests; one of the 6 is a known
false tie, below.

## Limits

- **One stated criterion in ten cases, written for this bench.** Only case 05's body states a criterion, and it states
  it as `Requirement: ...`, the marker the prototype reads, in a fixture whose expected reason already names SPK-02.
  The separation rests on that one case and is partly by construction. How often real pull requests state criteria in
  a form a marker can read is not measured here: these ten cases are the only ones the spike reads.
- **Descriptions are not read as criteria.** Four bodies describe the intended behaviour in a sentence with no marker:
  01 ("Totals are rounded to whole units."), 03, 06 and 07. A reviewer could take each as a requirement; the prototype
  does not, by rule, and the `no-criteria` fixture shows such a sentence would share words with its test if it did.
- **The outcome comes from a hand-written word list.** Accepting words (accept, allow, valid, permit, grant, approve,
  succeed) against refusing ones (reject, deny, refuse, invalid, block, forbid, disallow, throw, raise, error, decline),
  turned over by "not", "never" or "no" within three words. Case 05 separates only because its criterion says
  "rejected" and its assertion expects `isValid` to be true. A criterion with none of these words is tied on shared
  words alone and its expected value is never compared: the `false-tie-on-value` fixture asserts 101 for a total that
  rounds to 100 and is tied. Numbers, strings and structures are compared with nothing.
- **The subject comes from test names, a choice made after reading case 05.** Its live-token test uses the same
  `expires` field as the bad test. The data records both: that test shares "tokens" by name (`shared`) and "expired" by
  assertion (`assertion_shared`). Counting assertion words would give it the two words a tie needs and flag it as
  contradicting the criterion, a false contradiction. A test with a name that says nothing ("works", "case 1") matches
  no criterion.
- **Matching is by words.** English only, a light suffix stemmer and no synonyms: "found" does not match "finds", and
  "token" does not match "credential".
- **Two of the three places a requirement can be stated are not exercised by the cases.** No case links an issue, and
  an issue's text would need the network. No case carries a `REQUIREMENTS.md`, and the sandbox record holds no tree. A
  requirements file the pull request adds itself is written by the same hand as its test; the data marks it
  (`changed_by_pull_request`).
- **The labels are mine.** With no criterion in nine of ten cases, most of them follow from the absence of a marker.
- **The data follows its inputs.** A new BENCH-01 case or sandbox record changes `requirement-data.jsonl`, and
  SPK-02-AC02 catches the drift only when this task's criteria run.
- **It is static.** Whether a tied test passes, fails on base or ran at all is red-green's question, and mutation is
  RUN-05's.

## The decision

Decision for Ryan: keep it as a review hint, because the untied counts do not separate the wrong-assertion case (17 of 17 scored tests are untied, and case 05 has 0 tied as the legitimate 09 and sandbox #42 do) while its contradicts finding does, with 0 false ties and 0 false contradictions, but on the one case in ten that states a criterion, in the marker form the prototype reads; one positive cannot carry a verdict class, and as a hint it says nothing where no criterion is stated.

## Reproduce

```text
node tools/spikes/requirement.mjs                 # writes docs/spikes/requirement-data.jsonl
node --test tools/test/requirement.test.mjs       # the fixtures: ties, untied tests, contradictions, the false tie
```
