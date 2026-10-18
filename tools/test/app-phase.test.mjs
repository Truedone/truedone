// APP-06-AC13: the phase-line bench reads a tail jsonl in the tail-fields
// shape, counts the static stage's phase lines, and reports the App's own
// label time (phase1_ms + label_ms) at p50 and p95, with the version and the
// source passed through. Non-JSON lines and non-phase logs are skipped.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");
const TOOL = path.join(ROOT, "tools/bench/app-phase.mjs");
// The five tail lines inline: a fixtures file would sit outside APP-06's scope.
const TAIL = [
  '{"ts":1792352068841,"kind":"fetch /api/github/webhook","colo":"IAD","outcome":"ok","wallMs":582,"cpuMs":5,"logs":[]}',
  '{"ts":1792352070000,"kind":"fetch /api/github/webhook","colo":"IAD","outcome":"ok","wallMs":1200,"cpuMs":15,"logs":["{\\"stage\\":\\"static\\",\\"delivery\\":\\"d-1\\",\\"phase1_ms\\":22,\\"phase2_ms\\":380,\\"label_ms\\":1105,\\"check_ms\\":825,\\"label_write_ms\\":688,\\"total_ms\\":1151}"]}',
  '{"ts":1792352071000,"kind":"fetch /api/github/webhook","colo":"IAD","outcome":"ok","wallMs":1100,"cpuMs":14,"logs":["{\\"stage\\":\\"static\\",\\"delivery\\":\\"d-2\\",\\"phase1_ms\\":18,\\"phase2_ms\\":300,\\"label_ms\\":900,\\"check_ms\\":700,\\"label_write_ms\\":640,\\"total_ms\\":950}"]}',
  '{"ts":1792352072000,"kind":"queue","colo":"IAD","outcome":"ok","wallMs":300,"cpuMs":2,"logs":["not a phase line"]}',
  '{"this line is not json"}',
].join("\n");

test("the phase bench counts static lines and reports p50 and p95 of the App's label time", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "app-phase-"));
  const tail = path.join(dir, "tail.jsonl");
  fs.writeFileSync(tail, TAIL + "\n");
  const out = JSON.parse(execFileSync(process.execPath, [TOOL, tail, "--version", "test-sha"], { encoding: "utf8" }));
  assert.deepEqual(Object.keys(out).sort(), ["n", "p50_app_label_ms", "p95_app_label_ms", "source", "version"]);
  assert.equal(out.n, 2);
  assert.equal(out.p50_app_label_ms, 1022.5);
  assert.equal(out.p95_app_label_ms, 1127);
  assert.equal(out.version, "test-sha");
  assert.equal(out.source, tail);
});

test("an empty tail exits 1 and reports n 0", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "app-phase-empty-"));
  const empty = path.join(dir, "tail.jsonl");
  fs.writeFileSync(empty, "");
  try {
    let failed = false;
    let out = "";
    try { out = execFileSync(process.execPath, [TOOL, empty], { encoding: "utf8" }); } catch (e) { failed = true; out = e.stdout ?? ""; }
    assert.ok(failed, "an empty tail exited 0");
    const row = JSON.parse(out.trim().split("\n").pop());
    assert.equal(row.n, 0);
    assert.equal(row.p50_app_label_ms, null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
