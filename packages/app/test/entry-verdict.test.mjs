// APP-13-AC04: the Worker's own default export, with only fetch, KV and the queue message faked, on the recorded
// mgillr/truedone-sandbox#42 delivery and GitHub's recorded answers: exactly one check run and exactly one label, both
// carrying the verdict core.analyse gives for the recorded files, read the way the site reads them. That verdict is
// unrun; live on 2026-10-18 10:25Z the development App posted "not applicable" and no label for this pull request.
// The installation token is minted for real on a generated PKCS#1 key. The expected verdict comes through the same
// loadPR, so "unrun" is pinned by hand as well. The fixture's pull request is trimmed from GitHub's REST answer to the
// fields the stage reads; GitHub's webhook schema requires every one of them, changed_files included (loadPR pages
// the file list by it), in each pull_request delivery. head.repo may be null, for a deleted fork; loadPR then reads
// the head from the base repository.
import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.mjs";
import { analyse, classify } from "../../core/core.mjs";
import { loadPR } from "../../web/lib/github.mjs";
import { fakeGitHub, memoryKV, delivery, checkRuns, labelWrites, sandbox42, pkcs1Pem } from "./lib/github.mjs";

test("the entry posts exactly one check run and one label, with core's verdict for the recorded #42 files", async (t) => {
  const s = sandbox42();
  const fetch = fakeGitHub({ api: { ...s.api, "POST /app/installations/3/access_tokens": { token: "tok-42" } }, raw: s.raw });
  const site = await loadPR({ owner: s.owner, repo: s.repo, number: 42 }, {
    fetch: fakeGitHub({ api: { ...s.api, [`GET /repos/${s.owner}/${s.repo}/pulls/42`]: s.pull }, raw: s.raw }),
    classify,
  });
  const want = analyse({ ...site.input, releases: [] });
  assert.equal(want.verdict, "unrun");

  const orig = globalThis.fetch;
  globalThis.fetch = fetch;
  t.after(() => { globalThis.fetch = orig; });
  const m = { body: delivery(s.pull), acked: 0, retried: 0, ack() { this.acked += 1; }, retry() { this.retried += 1; } };
  await worker.queue({ messages: [m] }, { APP_ID: "12345", PRIVATE_KEY: await pkcs1Pem(), KV: memoryKV(), VERSION: "v" });
  assert.equal(m.acked, 1, `handled, retried ${m.retried}`);

  const checks = checkRuns(fetch);
  assert.equal(checks.length, 1, "exactly one check run");
  const check = JSON.parse(checks[0].body);
  assert.equal(check.head_sha, s.pull.head.sha);
  assert.equal(check.output.title, `truedone: ${want.verdict.replace(/_/g, " ")}`);
  assert.match(check.output.summary, /Why: https:\/\/truedone\.pages\.dev\/mgillr\/truedone-sandbox\/pull\/42$/);
  const labels = labelWrites(fetch, 42);
  assert.equal(labels.length, 1, "exactly one label");
  assert.deepEqual(JSON.parse(labels[0].body).labels, [want.label]);
});
