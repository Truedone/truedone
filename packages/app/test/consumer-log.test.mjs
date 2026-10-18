// APP-09-AC02: a failed delivery logs one line with the stage, the delivery id
// and the error name and message, never a secret, token or payload, before the
// retry. Main's bare catch retried with no log, so every delivery dropped to
// the dead-letter queue unseen.
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeConsumers } from "../src/index.mjs";

function fakeMessage({ event, delivery, payload }) {
  return {
    body: { event, delivery, payload },
    acked: 0,
    retried: 0,
    ack() { this.acked += 1; },
    retry() { this.retried += 1; },
  };
}

function captureErrors(t) {
  const lines = [];
  const orig = console.error;
  console.error = (line) => lines.push(String(line));
  t.after(() => { console.error = orig; });
  return lines;
}

const PAYLOAD = { installation: { id: 3 }, marker: "PAYLOAD-MARKER-7f3a" };

test("a failed mint logs stage mint, the delivery id and the error, then retries", async (t) => {
  const lines = captureErrors(t);
  const m = fakeMessage({ event: "pull_request", delivery: "d-42", payload: PAYLOAD });
  const consumers = makeConsumers({ mint: async () => { throw new TypeError("no usable key"); } });
  await consumers.queue({ messages: [m] }, {});
  assert.equal(m.retried, 1);
  assert.equal(m.acked, 0);
  assert.equal(lines.length, 1, `exactly one log line, got ${lines.length}`);
  const line = JSON.parse(lines[0]);
  assert.equal(line.stage, "mint");
  assert.equal(line.delivery, "d-42");
  assert.match(line.error, /TypeError: no usable key/);
});

test("a failed static stage logs stage static; a failed red-green stage logs red-green", async (t) => {
  const lines = captureErrors(t);
  const failStatic = makeConsumers({ mint: async () => "tok-1", staticStage: async () => { throw new RangeError("github 502"); } });
  const mStatic = fakeMessage({ event: "pull_request", delivery: "d-1", payload: PAYLOAD });
  await failStatic.queue({ messages: [mStatic] }, {});
  const failRedGreen = makeConsumers({ mint: async () => "tok-1", redGreenStage: async () => { throw new Error("run failed"); } });
  const mRed = fakeMessage({ event: "workflow_run", delivery: "d-2", payload: PAYLOAD });
  await failRedGreen.queue({ messages: [mRed] }, {});
  assert.equal(JSON.parse(lines[0]).stage, "static");
  assert.equal(JSON.parse(lines[1]).stage, "red-green");
  assert.equal(mStatic.retried, 1);
  assert.equal(mRed.retried, 1);
});

test("the log line carries no secret, token or payload", async (t) => {
  const lines = captureErrors(t);
  const m = fakeMessage({ event: "pull_request", delivery: "d-42", payload: PAYLOAD });
  const consumers = makeConsumers({ mint: async () => { throw new Error("boom"); } });
  await consumers.queue({ messages: [m] }, { PRIVATE_KEY: "PRIVATE-KEY-MARKER-91b2", WEBHOOK_SECRET: "WEBHOOK-SECRET-MARKER-4c8d" });
  const line = lines[0];
  assert.ok(line, "a line was logged");
  for (const marker of ["PAYLOAD-MARKER-7f3a", "PRIVATE-KEY-MARKER-91b2", "WEBHOOK-SECRET-MARKER-4c8d", "tok-"]) {
    assert.equal(line.includes(marker), false, `the log line carries no ${marker}`);
  }
});
