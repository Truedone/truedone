// SEC-04-AC01: every task id in the repository's proofline.json parses from a
// pull request title "<id>: a title", so an id of a new shape fails this suite
// before it can reach the gate.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { parseTaskId } from "../ci-gate.mjs";

const contract = JSON.parse(fs.readFileSync(new URL("../../proofline.json", import.meta.url), "utf8"));
const ids = contract.tasks.map((t) => t.id);

test("the contract has task ids to check", () => {
  assert.ok(ids.length > 0, "proofline.json lists no tasks");
});

test("every task id parses from a pull request title", () => {
  const failing = ids.filter((id) => parseTaskId(`${id}: a title`) !== id);
  assert.deepEqual(failing, []);
});

test("an id with a letter after the hyphen parses", () => {
  assert.equal(parseTaskId("REL-P1: x"), "REL-P1");
});

test("a lower-case title is still refused", () => {
  assert.equal(parseTaskId("rel-p1: x"), "");
  assert.equal(parseTaskId("sec-02: the title"), "");
});
