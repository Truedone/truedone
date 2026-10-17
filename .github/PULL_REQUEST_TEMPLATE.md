<!-- One task per pull request. The title starts with the task id, for example "CORE-01: analyse() reads the diff". -->

## Task id

<!-- The task in proofline.json that this pull request carries, for example CORE-01. -->

## The test that failed before and passes now

<!-- The test file and the test name, then its output on the parent commit (failing) and on this branch (passing). -->

Test:

Output before the change (failing):

```
```

Output after the change (passing):

```
```

## Checks run

- [ ] `npm test`
- [ ] `node tools/depmap-check.mjs`
- [ ] Every commit has a `Signed-off-by:` line (`git commit -s`)
- [ ] The change stays inside the task's scope
