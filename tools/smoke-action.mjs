#!/usr/bin/env node
// The ACT-03 end-to-end smoke (AC04) tests exactly the commit under test (the
// lead's 5058, 5174 and 5208): it pushes the head to refs/heads/smoke/<sha> on
// Truedone/truedone, pins the sandbox main's workflow uses line to
// Truedone/truedone/packages/action@<sha> through the contents API, seeds a
// pull request whose test fails on base and passes on head, and waits for the
// verdict label. The workflow's get, pin and restore go through the contents
// API, not a clone: GET answers the content in base64 plus the file's sha,
// PUT with that sha commits and answers commit.sha, and the restore PUTs the
// original bytes with the current sha; a clone's push failed to land in three
// runs while the API restored every time. A finally closes the PR, restores
// the sandbox line byte for byte (the restore PUT's echoed blob sha must
// equal the git blob sha of the bytes sent; measured on PR #744, a contents
// read even at the immutable restore commit answered stale bytes within
// seconds of the PUT),
// and deletes the ref; the pull request carries only the smoke files, so the
// app's tamper rule is never in play. Logs go to stderr; stdout carries only
// the final JSON line (AC04 captures stdout into a JSON file). The whole flow
// runs under one deadline of its own, shorter than the AC04 criterion's
// 1800 s, so a timeout ends the wait through the cleanup instead of a kill
// that would skip it (the lead's 5174). The smoke refuses to start unless the
// sandbox line is the documented @main pin, so a leftover pin from a failed
// run stops the next run. Runs on the lead runner in the landing; lanes never
// push (D25) and a lane run reports its push failures honestly.
// TRUEDONE_ACTION_USES is the verbatim override (REL-P4): set, it skips the
// ref push and delete.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

export const repo = process.argv.includes("--repo")
  ? process.argv[process.argv.indexOf("--repo") + 1]
  : "Truedone/truedone-sandbox";

// The documented starting line: the sandbox main carries the org's package
// path at main. Anything else is a leftover pin and the smoke refuses.
export const DOCUMENTED_PIN = "Truedone/truedone/packages/action@main";

// The truedone step is the uses line whose value names truedone-action@ or
// truedone/packages/action@, in any form. pinWorkflowUses returns the pinned
// text and the exact line it replaced; a workflow with no truedone uses line,
// or with two, throws before anything is sent.
export function pinWorkflowUses(workflow, uses) {
  const lines = workflow.split("\n");
  let at = -1;
  const out = lines.map((l, i) => {
    const m = l.match(/^(\s*(?:-\s+)?uses:\s*)(.*)$/);
    if (!m || !(m[2].includes("truedone-action@") || m[2].includes("truedone/packages/action@"))) return l;
    if (at !== -1) throw new Error("truedone: more than one truedone uses: line in .github/workflows/truedone.yml");
    at = i;
    return `${m[1]}${uses}`;
  });
  if (at === -1) throw new Error("truedone: no truedone uses: line in .github/workflows/truedone.yml");
  return { text: out.join("\n"), previousLine: lines[at] };
}

// Sets the truedone step's value back to the one previousLine carried.
export function restoreWorkflowUses(workflow, previousLine) {
  const value = previousLine.replace(/^\s*(?:-\s+)?uses:\s*/, "");
  return pinWorkflowUses(workflow, value).text;
}

// The verdict label is a truedone: label created after the head's workflow
// run completed: the app labels truedone:unrun on open, before any report
// (the lead's 5144), so an early label is not final.
export function labelAfter(events, sinceIso) {
  const since = Date.parse(sinceIso);
  const labeled = (events || [])
    .filter((e) => e && e.event === "labeled" && String(e.label?.name || "").startsWith("truedone:"))
    .map((e) => ({ name: e.label.name, at: Date.parse(e.created_at) }))
    .filter((e) => Number.isFinite(e.at) && Number.isFinite(since) && e.at > since)
    .sort((a, b) => a.at - b.at);
  return labeled.length ? labeled[0].name : null;
}

const gh = (...a) => execFileSync("gh", a, { encoding: "utf8" }).trim();

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

// runSmoke(io) is the whole flow; every effect goes through io so the tests
// drive it with fakes in the API's real answer shape. Order: validate the pin
// and the @main precondition before anything is sent; push the ref, pin
// through the contents API, seed the PR, wait for the run to complete and for
// a label set after that; and in a finally close the PR, restore through the
// API, verify the restore against the API's view of main, delete the ref. Any
// failure throws; the caller exits 1.
export async function runSmoke(io) {
  // One flow-wide deadline, shorter than the AC04 criterion's 1800 s: a
  // criterion timeout kills the process and a kill skips the finally, so the
  // smoke ends its own wait and runs the cleanup itself (the lead's 5174).
  const waitSeconds = process.env.TRUEDONE_SMOKE_WAIT_SECONDS ? Number(process.env.TRUEDONE_SMOKE_WAIT_SECONDS) : 1500;
  const flowDeadline = Date.now() + waitSeconds * 1000;
  const override = io.actionUses();
  let sha = null;
  let pushedRef = false;
  let previous = null;
  let pr = 0;
  try {
    sha = override ? null : io.headSha();
    const wf = io.getWorkflow();
    const uses = override ?? `Truedone/truedone/packages/action@${sha}`;
    const pinned = pinWorkflowUses(wf.text, uses);
    // previous is only set once the precondition holds, so a refused run
    // never walks the restore path.
    if (pinned.previousLine.replace(/^\s*(?:-\s+)?uses:\s*/, "") !== DOCUMENTED_PIN) {
      throw new Error(`truedone: the sandbox truedone.yml pins ${pinned.previousLine.trim()}, not the documented @main form; a previous run did not restore. Refusing to start.`);
    }
    previous = pinned.previousLine;
    if (sha) { io.pushSmokeRef(sha); pushedRef = true; }
    io.putWorkflow(pinned.text, wf.sha, `smoke: pin the sandbox workflow to the action under test${sha ? ` (smoke/${sha})` : ""}`);
    io.log(`truedone: the sandbox workflow uses ${uses}`);
    const seeded = io.seedAndOpenPr();
    pr = seeded.n;
    // The wait matters (ACT-03, lane-b's review item 8): a print before any
    // label could exist reads as a failure that is not one.
    const label = await io.waitForLabel(pr, seeded.headSha, flowDeadline);
    io.emit(JSON.stringify({ pr, label }));
    return 0;
  } finally {
    // Every cleanup step runs even when one fails; a failed restore is
    // rethrown only after the ref delete, so the run still leaves nothing
    // behind and exits non-zero.
    let restoreError = null;
    if (pr) {
      try { io.closePr(pr); } catch (error) { io.log(`truedone: closing PR ${pr} failed: ${error?.message ?? error}`); }
    }
    if (previous) {
      try {
        const current = io.getWorkflow();
        const restoreText = restoreWorkflowUses(current.text, previous);
        const restorePut = io.putWorkflow(restoreText, current.sha, "smoke: restore the sandbox workflow pin");
        // The restore is verified without a read: the PUT's answer carries the
        // new blob's sha, and the git blob sha of the exact bytes sent is
        // computed locally; equal shas prove the committed bytes are the
        // original's (a contents read even at the restore commit answered
        // stale bytes within seconds of the PUT, measured on PR #744).
        const expected = createHash("sha1").update(`blob ${Buffer.byteLength(restoreText)}\0`).update(restoreText).digest("hex");
        if (restorePut.content?.sha !== expected) {
          throw new Error(`truedone: the sandbox restore did not land: the restore commit's blob sha ${restorePut.content?.sha} is not the original's ${expected}`);
        }
        // refs/heads/main must point at the restore commit or a descendant;
        // the branch ref can lag, so poll for up to 30 s.
        const branchDeadline = Date.now() + 30_000;
        while (!io.mainIsAtOrDescendant(restorePut.commit.sha)) {
          if (Date.now() > branchDeadline) {
            throw new Error(`truedone: refs/heads/main did not reach the restore commit ${restorePut.commit.sha} within 30 s`);
          }
          await new Promise((r) => setTimeout(r, 3_000));
        }
      } catch (error) {
        io.log(`truedone: the sandbox pin restore failed: ${error?.message ?? error}`);
        restoreError = error;
      }
    }
    if (pushedRef) {
      try { io.deleteSmokeRef(sha); } catch (error) { io.log(`truedone: deleting refs/heads/smoke/${sha} failed: ${error?.message ?? error}`); }
    }
    if (restoreError) throw restoreError;
  }
}

// realIo(overrides) builds the production io; the overrides exist so tests
// can replace the GitHub-bound calls. Nothing inside the factory may name io:
// the factory builds io, so io is not in scope here.
export function realIo(overrides = {}) {
  const log = overrides.log ?? ((...a) => console.error(...a));
  const api = (...a) => execFileSync("gh", ["api", ...a], { encoding: "utf8" }).trim();
  const io = {
    actionUses: () => process.env.TRUEDONE_ACTION_USES,
    headSha: () => execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    pushSmokeRef: (sha) => { execFileSync("git", ["push", "origin", `${sha}:refs/heads/smoke/${sha}`], { stdio: "inherit" }); },
    deleteSmokeRef: (sha) => { execFileSync("git", ["push", "origin", "--delete", `smoke/${sha}`], { stdio: "inherit" }); },
    getWorkflow: () => {
      const r = JSON.parse(api(`repos/${repo}/contents/.github/workflows/truedone.yml?ref=main`));
      return { text: Buffer.from(r.content.replace(/\n/g, ""), "base64").toString("utf8"), sha: r.sha };
    },
    putWorkflow: (text, sha, message) => JSON.parse(api(
      `-X`, `PUT`, `repos/${repo}/contents/.github/workflows/truedone.yml`,
      `-f`, `message=${message}`,
      `-f`, `content=${Buffer.from(text, "utf8").toString("base64")}`,
      `-f`, `sha=${sha}`,
    )),
    mainIsAtOrDescendant: (sha) => ["behind", "identical"].includes(JSON.parse(api(`repos/${repo}/compare/main...${sha}`)).status),
    seedAndOpenPr: () => {
      const mainSha = JSON.parse(api(`repos/${repo}/git/refs/heads/main`)).object.sha;
      const branch = `act-smoke-${Date.now()}`;
      api(`-X`, `POST`, `repos/${repo}/git/refs`, `-f`, `ref=refs/heads/${branch}`, `-f`, `sha=${mainSha}`);
      // The seeded test sits in node-test/ (ACT-03, lane-b's review item 9): at
      // the sandbox root detect() finds no package.json above it and no runner,
      // so the action would report Could not run.
      const modulePut = JSON.parse(api(
        `-X`, `PUT`, `repos/${repo}/contents/src/smoke/mul.mjs`,
        `-f`, `message=smoke: the module under test`,
        `-f`, `content=${Buffer.from("export const mul = (a, b) => a * b;\n", "utf8").toString("base64")}`,
        `-f`, `branch=${branch}`,
      ));
      const testPut = JSON.parse(api(
        `-X`, `PUT`, `repos/${repo}/contents/node-test/smoke.test.mjs`,
        `-f`, `message=smoke: a seeded red-green pull request`,
        `-f`, `content=${Buffer.from(`import { test } from "node:test";\nimport assert from "node:assert/strict";\nimport * as smoke from "../src/smoke/mul.mjs";\ntest("mul multiplies", () => {\n  assert.equal(smoke.mul(2, 3), 6);\n});\n`, "utf8").toString("base64")}`,
        `-f`, `branch=${branch}`,
      ));
      const url = gh("pr", "create", "-R", repo, "--head", branch, "--title", "smoke: the action's red-green", "--body", "Seeded by tools/smoke-action.mjs: the test fails without the change and passes with it.");
      const n = Number(url.match(/\/pull\/(\d+)/)?.[1] ?? url.match(/\/(\d+)$/)?.[1] ?? 0);
      if (!n) throw new Error(`truedone: could not read the pull request number from ${url}`);
      return { n, headSha: testPut.commit.sha };
    },
    waitForLabel: async (n, headSha, flowDeadline) => {
      const deadline = flowDeadline ?? Date.now() + 1500 * 1000;
      // Wait for the head's workflow run to complete first: the app's opening
      // truedone:unrun is not final before that (the lead's 5144).
      // Since 09:22:25Z on 2026-10-19 the production App runs beside
      // truedone-dev on the whole Truedone organisation, sandbox included, so
      // the head's pull request gets one workflow run per app (the lead's
      // 5302). completedAt is the earliest completed run, recomputed each
      // poll: a verdict label from either app is final once its own run
      // completed, and every opening truedone:unrun is set before any
      // completion (the lead's 5144).
      const completedRuns = () => (JSON.parse(gh("api", `repos/${repo}/actions/runs?head_sha=${headSha}`)).workflow_runs || [])
        .filter((r) => r.event === "pull_request" && r.status === "completed");
      let completedAt = null;
      while (Date.now() < deadline) {
        const done = completedRuns();
        if (done.length) {
          completedAt = new Date(Math.min(...done.map((r) => Date.parse(r.updated_at)))).toISOString();
          break;
        }
        await new Promise((r) => setTimeout(r, 15_000));
      }
      if (!completedAt) throw new Error("truedone: the head's workflow run did not complete within AC04's window");
      while (Date.now() < deadline) {
        const done = completedRuns();
        if (done.length) completedAt = new Date(Math.min(...done.map((r) => Date.parse(r.updated_at)))).toISOString();
        const failed = done.filter((r) => r.conclusion === "failure");
        if (done.length > 0 && failed.length === done.length) {
          throw new Error(`truedone: the head's workflow run${failed.length > 1 ? "s" : ""} ${failed.map((r) => r.id).join(", ")} failed (conclusion failure); no report is coming`);
        }
        const events = JSON.parse(gh("api", `repos/${repo}/issues/${n}/events`));
        const labeled = (events || []).filter((e) => e && e.event === "labeled" && String(e.label?.name || "").startsWith("truedone:"));
        log(`truedone: the earliest completed run finished at ${completedAt}; labels so far: ${labeled.map((l) => `${l.label.name}@${l.created_at} by ${l.actor?.login ?? "unknown"}`).join(", ") || "none"}`);
        const label = labelAfter(events, completedAt);
        if (label) return label;
        await new Promise((r) => setTimeout(r, 15_000));
      }
      log("truedone: the wait ended on the deadline with no truedone: label after the run's completion");
      throw new Error(`truedone: no truedone: label set after the run completed on PR ${n} within AC04's window`);
    },
    closePr: (n) => { execFileSync("gh", ["pr", "close", String(n), "-R", repo, "--delete-branch"], { stdio: "inherit" }); },
    log: (...a) => console.error(...a),
    emit: (line) => console.log(line),
  };
  return { ...io, ...overrides };
}

if (invokedDirectly) {
  const code = await runSmoke(realIo()).catch((error) => {
    console.error(error?.message ?? String(error));
    return 1;
  });
  process.exit(code ?? 0);
}
