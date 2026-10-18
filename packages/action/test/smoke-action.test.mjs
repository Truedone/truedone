// The smoke's flow, driven through fakes in the contents API's real answer
// shape (GET answers content in base64 plus the file's sha; PUT answers
// commit.sha and content.sha): the pin lands on the sandbox main only from
// the documented @main line, a failing label wait still restores, the restore
// is verified by the restore PUT's echoed blob sha against the bytes sent and
// a mismatch fails the run,
// the TRUEDONE_ACTION_USES override skips the ref entirely, and a workflow
// with no truedone uses line stops the smoke before anything is sent.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { labelAfter, pinWorkflowUses, restoreWorkflowUses, runSmoke } from "../../../tools/smoke-action.mjs";

const SHA = "b".repeat(40);
const MAIN_PIN = "      - uses: Truedone/truedone/packages/action@main";
const WORKFLOW = `name: truedone\non: [pull_request]\njobs:\n  run:\n    steps:\n      - uses: actions/checkout@v4\n${MAIN_PIN}\n`;
const WORKFLOW_SHA = "wfsha-1";
const B64 = (s) => Buffer.from(s, "utf8").toString("base64");
const blobSha = (s) => createHash("sha1").update(`blob ${Buffer.byteLength(s)}\0`).update(s).digest("hex");

function fakeIo({ override = null, workflow = WORKFLOW, failLabel = false, restoreBlob = null } = {}) {
  const io = {
    order: [],
    logs: [],
    emitted: [],
    puts: [],
    deleted: [],
    pushedRef: null,
    mainReachable: true,
    actionUses: () => override,
    headSha: () => { io.order.push("headSha"); return SHA; },
    pushSmokeRef: (sha) => { io.order.push("pushSmokeRef"); io.pushedRef = sha; },
    deleteSmokeRef: (sha) => { io.order.push("deleteSmokeRef"); io.deleted.push(sha); },
    getWorkflow: () => { io.order.push("getWorkflow"); return { text: workflow, sha: WORKFLOW_SHA }; },
    putWorkflow: (text, sha, message) => {
      io.order.push("putWorkflow");
      io.puts.push({ text, sha, message });
      return { commit: { sha: `commit-${io.puts.length}` }, content: { sha: restoreBlob ?? blobSha(text) } };
    },
    mainIsAtOrDescendant: (sha) => { io.order.push("mainIsAtOrDescendant"); return io.mainReachable; },
    seedAndOpenPr: () => { io.order.push("seedAndOpenPr"); return { n: 33, headSha: "fakehead" }; },
    waitForLabel: async () => { io.order.push("waitForLabel"); if (failLabel) throw new Error("truedone: no truedone: label set after the run completed on PR 33 within AC04's window"); return "truedone:yes"; },
    closePr: () => { io.order.push("closePr"); },
    log: (line) => { io.order.push("log"); io.logs.push(line); },
    emit: (line) => { io.order.push("emit"); io.emitted.push(line); },
  };
  return io;
}

test("the flow pins through the contents API and the finally restores and deletes", async () => {
  const io = fakeIo();
  const rc = await runSmoke(io);
  assert.equal(rc, 0);
  assert.deepEqual(io.order, [
    "headSha", "getWorkflow", "pushSmokeRef", "putWorkflow", "log",
    "seedAndOpenPr", "waitForLabel", "emit", "closePr", "getWorkflow", "putWorkflow",
    "mainIsAtOrDescendant", "deleteSmokeRef",
  ]);
  assert.equal(io.pushedRef, SHA);
  assert.deepEqual(io.deleted, [SHA]);
  assert.equal(io.puts[0].sha, WORKFLOW_SHA, "the pin PUT does not carry the recorded file sha");
  assert.ok(io.puts[0].text.includes(`uses: Truedone/truedone/packages/action@${SHA}`), "the pin is not the head sha");
  assert.ok(io.puts[0].message.includes(`(smoke/${SHA})`), "the pin message does not name the ref");
  assert.equal(io.puts[1].text, WORKFLOW, "the restore is not byte for byte");
  assert.equal(io.puts[1].message, "smoke: restore the sandbox workflow pin");
  assert.deepEqual(io.emitted, [JSON.stringify({ pr: 33, label: "truedone:yes" })], "stdout carries more than the JSON line");
  assert.ok(io.logs.some((l) => l.includes(`uses Truedone/truedone/packages/action@${SHA}`)), "the uses line is not logged");
});

test("a leftover pin refuses the run before anything is sent", async () => {
  const leftover = WORKFLOW.replace(MAIN_PIN, `      - uses: Truedone/truedone/packages/action@${"c".repeat(40)}`);
  const io = fakeIo({ workflow: leftover });
  await assert.rejects(runSmoke(io), /not the documented @main form/);
  assert.ok(!io.order.includes("pushSmokeRef"), "the ref was sent despite the leftover pin");
  assert.ok(!io.order.includes("putWorkflow"), "the contents PUT ran despite the leftover pin");
});

test("a restore whose committed bytes differ fails the run even after a good label", async () => {
  const io = fakeIo({ restoreBlob: "0".repeat(40) });
  await assert.rejects(runSmoke(io), /did not land/);
  assert.ok(!io.order.includes("mainIsAtOrDescendant"), "the branch poll ran despite the mismatch");
  assert.ok(io.order.includes("emit"), "the label phase did not run");
  assert.ok(io.logs.some((l) => l.includes("did not land")), "the mismatch is not on stderr");
  assert.deepEqual(io.deleted, [SHA], "the ref is still deleted when the restore fails");
});

test("a failing label wait still restores the line, verifies it, and deletes the ref", async () => {
  const io = fakeIo({ failLabel: true });
  await assert.rejects(runSmoke(io), /no truedone: label/);
  assert.deepEqual(io.order.slice(-5), ["closePr", "getWorkflow", "putWorkflow", "mainIsAtOrDescendant", "deleteSmokeRef"]);
  assert.equal(io.puts[1].text, WORKFLOW, "the restore did not run on failure");
  assert.equal(io.puts[1].message, "smoke: restore the sandbox workflow pin");
});

test("the override skips the ref and pins its value verbatim", async () => {
  const io = fakeIo({ override: "Truedone/truedone-action@v0.1.0" });
  const rc = await runSmoke(io);
  assert.equal(rc, 0);
  assert.ok(!io.order.includes("headSha"), "the override path read a head sha");
  assert.ok(!io.order.includes("pushSmokeRef"), "the override path pushed the smoke ref");
  assert.ok(!io.order.includes("deleteSmokeRef"), "the override path deleted the smoke ref");
  assert.ok(io.puts[0].text.includes("uses: Truedone/truedone-action@v0.1.0"), "the override value was not used verbatim");
  assert.equal(io.puts[1].text, WORKFLOW, "the override path did not restore");
});

test("a workflow with no truedone uses line stops the smoke before anything is sent", async () => {
  const io = fakeIo({ workflow: "name: truedone\non: [pull_request]\n" });
  await assert.rejects(runSmoke(io), /no truedone uses: line/);
  assert.ok(!io.order.includes("pushSmokeRef"), "the ref was sent despite the missing line");
  assert.ok(!io.order.includes("putWorkflow"), "the contents PUT ran despite the missing line");
});

test("pinWorkflowUses replaces the value, and restoreWorkflowUses round-trips it", () => {
  const pinned = pinWorkflowUses(WORKFLOW, `Truedone/truedone/packages/action@${SHA}`);
  assert.ok(pinned.text.includes(`uses: Truedone/truedone/packages/action@${SHA}`));
  assert.equal(pinned.previousLine, MAIN_PIN);
  assert.equal(restoreWorkflowUses(pinned.text, MAIN_PIN), WORKFLOW);
  assert.throws(() => pinWorkflowUses("no uses line here", "x"), /no truedone uses: line/);
  const two = WORKFLOW + "      - uses: Truedone/truedone/packages/action@main\n";
  assert.throws(() => pinWorkflowUses(two, "x"), /more than one truedone uses: line/);
});

test("the verdict label is the first truedone: label set after the run completed", () => {
  const events = [
    { event: "labeled", label: { name: "truedone:unrun" }, created_at: "2026-10-19T03:48:23Z" },
    { event: "labeled", label: { name: "truedone:yes" }, created_at: "2026-10-19T03:48:41Z" },
  ];
  assert.equal(labelAfter(events, "2026-10-19T03:48:35Z"), "truedone:yes", "the opening unrun is not final");
  assert.equal(labelAfter(events, "2026-10-19T03:48:41Z"), null, "nothing after the boundary yet");
  assert.equal(labelAfter([], "2026-10-19T03:48:35Z"), null);
});
