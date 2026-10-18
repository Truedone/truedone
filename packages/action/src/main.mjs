// The red-green executor (ACT-03): D6 base, D7 swap in place, D8 coverage
// condition named in the report, S2 exact restore. The action runs on the
// runner's Node and installs nothing; core/run does the running.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { classify } from "../../../packages/core/src/classify.mjs";
import { detect } from "../../../packages/core/run/detect.mjs";
import { redGreen } from "../../../packages/core/run/run.mjs";
import { uploadReport } from "./upload.mjs";

function git(args, cwd) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

// Content reads must not be trimmed: a dropped trailing newline turns an
// append-only diff into a replacement hunk and every line reads as changed.
function gitRaw(args, cwd) {
  return execFileSync("git", args, { cwd, encoding: "utf8" });
}

// D6 as the lead's 5261 states it, measured from the checkout log:
// actions/checkout fetches the merge commit by sha at depth 1 and checks it
// out, so the base is the merge commit's FIRST PARENT (HEAD^1), and the
// change set is the two-dot diff HEAD^1..HEAD — merging the PR into its base
// gives exactly the PR's changes with no merge base needed. If a workflow
// checked out the PR head instead, the base is pull_request.base.sha from the
// event, fetched at depth 1 when the checkout lacks it — never a blind
// deepen. The report carries the PR head sha, which is what the app matches
// (PV-A06).
export function resolveBase({ eventPath, cwd, githubSha }) {
  const event = JSON.parse(fs.readFileSync(eventPath, "utf8"));
  const pr = event.pull_request ?? {};
  const checkedOut = githubSha || event.pull_request?.merge_commit_sha || pr.head?.sha;
  if (!checkedOut) throw new Error("no checked-out commit in the event");
  const headCheckout = pr.head?.sha != null && checkedOut === pr.head.sha;
  let base;
  if (headCheckout) {
    base = pr.base?.sha;
    if (base && !objectExists(base, cwd)) {
      git(["fetch", "--no-tags", "--depth=1", "origin", base], cwd);
    }
    if (!base) throw new Error("the event carries no pull_request.base.sha and the checkout is the PR head; the base cannot be determined");
  } else {
    // In a shallow clone a plain rev-parse echoes an unresolvable suffix as
    // a literal: --verify must fail loudly so the deepen actually happens.
    const firstParent = () => git(["rev-parse", "--verify", `${checkedOut}^1^{commit}`], cwd);
    try {
      base = firstParent();
    } catch {
      try {
        git(["fetch", "--no-tags", "--depth=2", "origin", checkedOut], cwd);
        base = firstParent();
      } catch {
        throw new Error(`the checked-out commit ${checkedOut} has no first parent`);
      }
    }
  }
  return { base, prHead: pr.head?.sha ?? checkedOut, event };
}

function objectExists(sha, cwd) {
  try {
    git(["cat-file", "-e", `${sha}^{commit}`], cwd);
    return true;
  } catch {
    return false;
  }
}

// The PR's changed files with their base contents, for the D7 swap.
export function changedFiles(base, cwd) {
  const out = [];
  // The merge commit over its first parent is exactly the PR's changes, with
  // no merge base needed (the lead's 5261); the two endpoints are named
  // directly so no range parsing walks the shallow history.
  for (const line of git(["diff", "--name-status", base, "HEAD"], cwd).split("\n").filter(Boolean)) {
    const [status, from, to] = line.split("\t");
    const p = to || from;
    let baseContent = null;
    let headContent = null;
    if (status !== "A") {
      try { baseContent = gitRaw(["show", `${base}:${from || p}`], cwd); } catch { baseContent = null; }
    }
    if (status !== "D") {
      try { headContent = fs.readFileSync(path.join(cwd, p), "utf8"); } catch { headContent = null; }
    }
    out.push({ path: p, status: status === "A" ? "added" : status === "D" ? "deleted" : "modified", base: baseContent, head: headContent });
  }
  return out;
}

// The head-side line ranges a change touches, from git diff --no-index hunks.
function changedLines(baseText, headText, dir) {
  const a = path.join(dir, "base.txt");
  const b = path.join(dir, "head.txt");
  fs.writeFileSync(a, String(baseText ?? ""));
  fs.writeFileSync(b, String(headText ?? ""));
  let diff = "";
  try { diff = git(["diff", "--no-index", "--unified=0", a, b], dir); } catch (e) { diff = e.stdout ?? ""; }
  const lines = new Set();
  for (const m of diff.matchAll(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm)) {
    const start = Number(m[1]);
    const count = m[2] === undefined ? 1 : Number(m[2]);
    for (let i = 0; i < Math.max(count, 1); i++) lines.add(start + i);
  }
  return lines;
}

function offsetToLine(text, offset) {
  let line = 1;
  for (let i = 0; i < offset && i < text.length; i++) if (text[i] === "\n") line++;
  return line;
}

// D8: which condition the report names. V8 coverage from the head runs proves
// 'lines'; where coverage cannot speak (a file whose base and head contents are
// the same length, python tests), the one-hop import check gives 'imports'.
export function computeCondition({ coverageDir, files, tests, root, tmpDir }) {
  // Coverage URLs carry the volume's real path; the checkout may sit behind a
  // symlink, so both sides are canonicalised before the relative mapping.
  let realRoot = root;
  try { realRoot = fs.realpathSync(root); } catch { /* keep root */ }
  const sources = files.filter((f) => f.status !== "deleted" && classify(f.path) === "source");
  const headTexts = new Map(sources.map((f) => [f.path, fs.readFileSync(path.join(root, f.path), "utf8")]));
  const changed = new Map();
  for (const f of sources) changed.set(f.path, changedLines(f.base, headTexts.get(f.path), tmpDir));

  let coveredLines = new Map();
  let sawCoverage = false;
  if (fs.existsSync(coverageDir)) {
    for (const name of fs.readdirSync(coverageDir)) {
      if (!name.endsWith(".json")) continue;
      let json;
      try { json = JSON.parse(fs.readFileSync(path.join(coverageDir, name), "utf8")); } catch { continue; }
      for (const entry of json.result ?? []) {
        const rel = decodeURIComponent((entry.url || "").replace(/^file:\/\//, ""));
        const relPath = path.relative(realRoot, rel);
        if (!changed.has(relPath)) continue;
        const baseChars = (sources.find((f) => f.path === relPath)?.base ?? "").length;
        const headChars = headTexts.get(relPath).length;
        let maxOffset = 0;
        for (const fn of entry.functions ?? []) for (const r of fn.ranges ?? []) maxOffset = Math.max(maxOffset, r.endOffset);
        // Coverage offsets are character offsets into whichever content was on
        // disk when that process ran. They are trusted only when they exceed the
        // shorter content, so only one version's space can have produced them.
        if (maxOffset > headChars) continue;
        if (maxOffset <= Math.min(baseChars, headChars)) continue;
        sawCoverage = true;
        const text = headTexts.get(relPath);
        // Block-level coverage: a line ran only when the DEEPEST range holding
        // it has a count, so an uncalled function's own zero range wins over
        // the module scope's whole-file range.
        const ranges = [];
        for (const fn of entry.functions ?? []) {
          const fc = fn.count ?? 0;
          for (const r of fn.ranges ?? []) ranges.push({ start: r.startOffset, end: r.endOffset, count: r.count ?? fc });
        }
        const coveredAt = (offset) => {
          let best = null;
          for (const r of ranges) {
            if (r.start <= offset && offset < r.end) {
              if (!best || r.end - r.start < best.end - best.start) best = r;
            }
          }
          return best ? best.count > 0 : false;
        };
        const hit = coveredLines.get(relPath) ?? new Set();
        const lines = text.split("\n");
        let lineStart = 0;
        for (let l = 1; l <= lines.length; l++) {
          // V8 ranges are end-exclusive: the last CONTENT character of the
          // line sits inside the deepest block that owns the line's code,
          // while the trailing newline belongs to the enclosing scope.
          const lineEnd = lineStart + lines[l - 1].length - 1;
          if (lines[l - 1].length > 0 && coveredAt(Math.min(lineEnd, text.length - 1))) hit.add(l);
          lineStart += lines[l - 1].length + 1;
        }
        coveredLines.set(relPath, hit);
      }
    }
  }
  let linesHold = false;
  for (const [p, hit] of coveredLines) {
    if (process.env.TRUEDONE_COVERAGE_DEBUG) {
      console.error(`truedone: coverage debug ${p}: changed=[${[...changed.get(p)].join(",")}] covered=[${[...hit].sort((a, b) => a - b).join(",")}]`);
    }
    for (const l of hit) if (changed.get(p)?.has(l)) linesHold = true;
  }

  const importsHold = tests.length ? importsHop(tests, sources.map((f) => f.path), root) : false;
  const condition = linesHold ? "lines" : importsHold ? "imports" : "none";
  return { condition, sawCoverage, linesHold, importsHold };
}

// One hop: a changed module is imported by the test, or by a module the test imports.
function importsHop(testPaths, changedPaths, root) {
  const changedSet = new Set(changedPaths);
  const specsOf = (text) => [...text.matchAll(/(?:from\s+|require\(\s*|import\s+)["']([^"']+)["']/g)].map((m) => m[1]);
  const resolve = (fromFile, spec) => {
    if (!spec.startsWith(".")) return null;
    const base = path.resolve(path.dirname(path.join(root, fromFile)), spec);
    for (const cand of [base, `${base}.mjs`, `${base}.js`, `${base}.cjs`, path.join(base, "index.mjs"), path.join(base, "index.js")]) {
      const rel = path.relative(root, cand);
      if (!rel.startsWith("..") && fs.existsSync(cand)) return rel;
    }
    return null;
  };
  for (const t of testPaths) {
    let text;
    try { text = fs.readFileSync(path.join(root, t), "utf8"); } catch { continue; }
    const seen = new Set([t]);
    let frontier = specsOf(text).map((s) => resolve(t, s)).filter(Boolean);
    for (const f of frontier) if (changedSet.has(f)) return true;
    for (const f of frontier) {
      if (seen.has(f)) continue;
      seen.add(f);
      let inner;
      try { inner = fs.readFileSync(path.join(root, f), "utf8"); } catch { continue; }
      for (const s of specsOf(inner)) {
        const r = resolve(f, s);
        if (r && changedSet.has(r)) return true;
      }
    }
  }
  return false;
}

function porcelainSnapshot(cwd) {
  return { head: git(["rev-parse", "HEAD"], cwd), status: git(["status", "--porcelain"], cwd) };
}

// PV-A06: a verdict is proven by the step that ran, so the report carries the
// action's ref when it is a full sha and nothing otherwise; an unpinned @main
// step cannot be proven.
export function provedStep(ref) {
  return /^[0-9a-f]{40}$/.test(String(ref || "")) ? String(ref) : "";
}

// The step: returns { code, report? } and prints what happened. S2 holds unless
// the checkout is exactly as it was; any restore failure reports Could not run.
export async function runGate(context) {
  const root = context.root;
  const before = porcelainSnapshot(root);
  let base, prHead;
  try {
    ({ base, prHead } = resolveBase({ eventPath: context.eventPath, cwd: root, githubSha: context.githubSha }));
  } catch (e) {
    console.error(`truedone: Could not run: ${e.message}`);
    return { code: 1 };
  }
  const files = changedFiles(base, root);
  const testPaths = files.filter((f) => ["test", "test_helper"].includes(classify(f.path)) && f.status !== "deleted").map((f) => f.path);
  if (!testPaths.length) {
    console.log("truedone: no changed test files; nothing to red-green here.");
    return { code: 0 };
  }
  const detected = detect(root, testPaths, context.configText);
  const covDir = fs.mkdtempSync(path.join(os.tmpdir(), "truedone-cov-"));
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "truedone-diff-"));
  const outer = { ...((context.env ?? process.env)) };
  // The inner run is a fresh test process, never a nested one.
  delete outer.NODE_TEST_CONTEXT;
  const env = { ...outer, NODE_V8_COVERAGE: covDir };
  let report;
  try {
    report = await redGreen({ root, tests: detected, files, base, head: prHead, env, exec: context.exec });
  } catch (e) {
    console.error(`truedone: Could not run: ${e.message}`);
    return { code: 1 };
  } finally {
    const after = porcelainSnapshot(root);
    if (after.head !== before.head || after.status !== before.status) {
      console.error(`truedone: Could not run: the checkout changed (S2): HEAD ${before.head.slice(0, 8)} -> ${after.head.slice(0, 8)}, status changed: ${after.status !== before.status}`);
      return { code: 1 };
    }
  }
  const condition = computeCondition({ coverageDir: covDir, files, tests: testPaths, root, tmpDir });
  for (const t of report.tests) {
    t.condition = condition.condition;
    t.asserts_new_symbol = (t.base ?? []).includes("fail:missing");
  }
  report.job = process.env.GITHUB_JOB ?? null;
  report.proved_step = provedStep(env.GITHUB_ACTION_REF);
  fs.rmSync(covDir, { recursive: true, force: true });
  fs.rmSync(tmpDir, { recursive: true, force: true });
  const after = porcelainSnapshot(root);
  if (after.head !== before.head || after.status !== before.status) {
    console.error(`truedone: Could not run: the checkout changed (S2) after the run`);
    return { code: 1 };
  }
  if (report.could_not_run) {
    console.error(`truedone: Could not run: ${report.could_not_run.reason}: ${report.could_not_run.detail ?? ""}`);
    await deliver(context, report);
    return { code: 1, report };
  }
  console.log(`truedone: coverage condition: ${condition.condition}${condition.linesHold ? "" : condition.importsHold ? " (one-hop import fallback)" : ""}`);
  await deliver(context, report);
  return { code: 0, report };
}

async function deliver(context, report) {
  const text = JSON.stringify(report, null, 2);
  const token = (context.uploadEnv ?? process.env).ACTIONS_RUNTIME_TOKEN;
  const url = (context.uploadEnv ?? process.env).ACTIONS_RESULTS_URL;
  if (token && url) {
    try {
      const r = await uploadReport({ ACTIONS_RUNTIME_TOKEN: token, ACTIONS_RESULTS_URL: url, GITHUB_RUN_ID: process.env.GITHUB_RUN_ID }, { jobId: process.env.GITHUB_JOB ?? "job", fileName: "report.json", contents: text });
      console.log(`truedone: the report is uploaded as ${r.name} (${r.size} bytes)`);
    } catch (e) {
      console.error(`truedone: the report upload failed: ${e.message}`);
    }
  } else {
    console.log(`truedone: no Actions artifact environment; the report follows.\n${text}`);
  }
}
