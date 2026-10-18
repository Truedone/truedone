// The coverage condition (RUN-04, D8): which changed lines a test actually
// ran. Node collects through NODE_V8_COVERAGE and the offsets are mapped to
// original lines, through the transform's inline source map when the module
// is TypeScript. Python collects through a pytest plugin written to a
// temporary directory, using sys.monitoring on 3.12 and newer and sys.settrace
// below. When coverage of the changed lines cannot be collected, the
// condition falls back to imports: one hop from the test counts, two do not.
// The condition decided here is the one the report names.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

// A source-map mappings string decoded without dependencies: per generated
// line, the segments' generated column and, when present, source index,
// source line and source column (all cumulative VLQ deltas).
export function decodeMappings(mappings) {
  const out = [];
  for (const line of mappings.split(';')) {
    let genCol = 0;
    let srcIdx = 0;
    let srcLine = 0;
    let srcCol = 0;
    const group = [];
    for (const seg of line.split(',')) {
      if (!seg) continue;
      const vals = [];
      let shift = 0;
      let value = 0;
      for (const ch of seg) {
        const digit = B64.indexOf(ch);
        if (digit < 0) break;
        value += (digit & 31) << shift;
        if (digit & 32) { shift += 5; } else {
          const negative = value & 1;
          value >>= 1;
          vals.push(negative ? -value : value);
          shift = 0;
          value = 0;
        }
      }
      genCol += vals[0] || 0;
      if (vals.length >= 4) {
        srcIdx += vals[1];
        srcLine += vals[2];
        srcCol += vals[3];
        group.push({ genCol, srcIdx, srcLine, srcCol });
      } else {
        group.push({ genCol });
      }
    }
    out.push(group);
  }
  return out;
}

// The original position of one offset in transformed text, through the map.
export function originalPosition(text, map, decoded, offset) {
  const code = text.slice(0, text.indexOf('//# sourceMappingURL'));
  const lineStarts = [0];
  for (let i = 0; i < code.length; i++) if (code[i] === '\n') lineStarts.push(i + 1);
  let gl = 0;
  while (gl + 1 < lineStarts.length && lineStarts[gl + 1] <= offset) gl++;
  const genCol = offset - lineStarts[gl];
  let last = null;
  let srcIdx = 0;
  for (let l = 0; l <= gl && l < decoded.length; l++) {
    for (const seg of decoded[l]) {
      if (seg.srcLine !== undefined) {
        last = seg;
        srcIdx = seg.srcIdx;
      }
      if (l === gl && seg.genCol > genCol) break;
    }
    if (l === gl) {
      let hit = null;
      for (const seg of decoded[l]) {
        if (seg.genCol <= genCol && seg.srcLine !== undefined) hit = seg;
      }
      if (hit) { last = hit; srcIdx = hit.srcIdx; }
    }
  }
  if (!last) return null;
  return { source: (map.sources || [])[srcIdx] ?? null, line: last.srcLine + 1, column: last.srcCol };
}

// Covered lines per changed file from a NODE_V8_COVERAGE directory. Offsets
// are mapped through the module's inline source map when it has one (a
// TypeScript transform), and taken directly otherwise. A line counts as
// covered when the deepest range holding it has a count.
export function coveredLinesFromV8({ coverageDir, root, files }) {
  const realRoot = (() => { try { return fs.realpathSync(root); } catch { return root; } })();
  const changed = new Map(files.map((f) => [f.path, f]));
  const covered = new Map();
  let sawCoverage = false;
  if (!fs.existsSync(coverageDir)) return { covered, sawCoverage };
  for (const name of fs.readdirSync(coverageDir)) {
    if (!name.endsWith('.json')) continue;
    let json;
    try { json = JSON.parse(fs.readFileSync(path.join(coverageDir, name), 'utf8')); } catch { continue; }
    for (const entry of json.result || []) {
      const file = path.relative(realRoot, decodeURIComponent((entry.url || '').replace(/^file:\/\//, '')));
      if (!changed.has(file)) continue;
      const record = changed.get(file);
      const headText = fs.readFileSync(path.join(root, file), 'utf8');
      const baseChars = String(record.base ?? '').length;
      const headChars = headText.length;
      const ranges = [];
      let maxOffset = 0;
      for (const fn of entry.functions || []) {
        for (const r of fn.ranges || []) {
          ranges.push({ start: r.startOffset, end: r.endOffset, count: r.count ?? fn.count ?? 0 });
          maxOffset = Math.max(maxOffset, r.endOffset);
        }
      }
      if (maxOffset > headChars || maxOffset <= Math.min(baseChars, headChars)) continue;
      sawCoverage = true;
      const inline = /\/\/[#@]\s*sourceMappingURL=data:application\/json;base64,([A-Za-z0-9+/=]+)/.exec(headText);
      const hit = covered.get(file) ?? new Set();
      const coveredAt = (offset) => {
        let best = null;
        for (const r of ranges) {
          if (r.start <= offset && offset < r.end && (!best || r.end - r.start < best.end - best.start)) best = r;
        }
        return best ? best.count > 0 : false;
      };
      const lines = headText.split('\n');
      let lineStart = 0;
      for (let l = 1; l <= lines.length; l++) {
        if (lines[l - 1].length > 0) {
          let line = l;
          if (inline) {
            const map = JSON.parse(Buffer.from(inline[1], 'base64').toString('utf8'));
            const decoded = decodeMappings(map.mappings);
            const pos = originalPosition(headText, map, decoded, lineStart + lines[l - 1].length - 1);
            if (pos) line = pos.line;
          }
          if (coveredAt(lineStart + lines[l - 1].length - 1)) hit.add(line);
        }
        lineStart += lines[l - 1].length + 1;
      }
      covered.set(file, hit);
    }
  }
  return { covered, sawCoverage };
}

// The Python collector: a pytest plugin written to a temporary directory that
// records executed (file, line) pairs with sys.monitoring on 3.12 and newer
// and sys.settrace below, then dumps them as JSON on exit. The caller runs
// pytest with PYTHONPATH pointed at the plugin directory and reads the file.
export function writePythonPlugin(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const plugin = path.join(dir, 'truedone_coverage_plugin.py');
  fs.writeFileSync(plugin, `import json, os, sys

_out = os.environ.get("TRUEDONE_PY_COVERAGE_OUT", "")
_root = os.environ.get("TRUEDONE_PY_ROOT", os.getcwd())
_collected = {}

def _record(path, lineno):
    try:
        rel = os.path.relpath(os.path.realpath(path), os.path.realpath(_root))
    except ValueError:
        rel = path
    _collected.setdefault(rel, set()).add(lineno)

def _flush():
    if not _out:
        return
    data = {k: sorted(v) for k, v in _collected.items()}
    with open(_out, "w") as handle:
        json.dump(data, handle)

import threading

if sys.version_info >= (3, 12):
    def _monitor(code, number):
        _record(code.co_filename, number)

    started = threading.local()

    _tool = None

    def pytest_sessionstart(session):
        global _tool
        for candidate in (5, 4, 3, 2, 1):
            try:
                sys.monitoring.use_tool_id(candidate, "truedone")
                sys.monitoring.register_callback(candidate, sys.monitoring.events.LINE, _monitor)
                _tool = candidate
                break
            except ValueError:
                continue
        if _tool is None:
            return
        sys.monitoring.set_events(_tool, sys.monitoring.events.LINE)

    def pytest_sessionfinish(session, exitstatus):
        if _tool is not None:
            sys.monitoring.set_events(_tool, 0)
            sys.monitoring.free_tool_id(_tool)
        _flush()
else:
    def _trace(frame, event, arg):
        if event == "line":
            _record(frame.f_code.co_filename, frame.f_lineno)
        return _trace

    def pytest_sessionstart(session):
        sys.settrace(_trace)
        threading.settrace(_trace)

    def pytest_sessionfinish(session, exitstatus):
        sys.settrace(None)
        _flush()
`);
  return plugin;
}

// One hop: a changed module is imported by the test, or by a module the test
// imports. Two hops do not count.
export function importsHold(testPaths, changedPaths, root) {
  const changedSet = new Set(changedPaths);
  const specsOf = (text) => [...text.matchAll(/(?:from\s+|require\(\s*|import\s+)["']([^"']+)["']/g)].map((m) => m[1]);
  const resolve = (fromFile, spec) => {
    if (!spec.startsWith('.')) return null;
    const base = path.resolve(path.dirname(path.join(root, fromFile)), spec);
    for (const cand of [base, `${base}.mjs`, `${base}.js`, `${base}.cjs`, `${base}.py`, path.join(base, 'index.mjs'), path.join(base, 'index.js')]) {
      const rel = path.relative(root, cand);
      if (!rel.startsWith('..') && fs.existsSync(cand)) return rel;
    }
    return null;
  };
  for (const t of testPaths) {
    let text;
    try { text = fs.readFileSync(path.join(root, t), 'utf8'); } catch { continue; }
    const seen = new Set([t]);
    const frontier = specsOf(text).map((s) => resolve(t, s)).filter(Boolean);
    for (const f of frontier) if (changedSet.has(f)) return true;
    for (const f of frontier) {
      if (seen.has(f)) continue;
      seen.add(f);
      let inner;
      try { inner = fs.readFileSync(path.join(root, f), 'utf8'); } catch { continue; }
      for (const s of specsOf(inner)) {
        const r = resolve(f, s);
        if (r && changedSet.has(r)) return true;
      }
    }
  }
  return false;
}

export function decideCondition({ linesHold, importsHold }) {
  return linesHold ? 'lines' : importsHold ? 'imports' : 'none';
}

// The condition for one run: Node lines from the V8 directory, Python lines
// from the collector file, the one-hop import fallback when neither speaks,
// and the decision the report names.
export function conditionFor({ coverageDir, pythonCoverageFile, root, files, tests }) {
  const sources = files.filter((f) => f.status !== 'deleted' && isSource(f.path));
  const changedPaths = sources.map((f) => f.path);
  const { covered: jsCovered, sawCoverage } = coveredLinesFromV8({ coverageDir, root, files });
  const pyCovered = readPythonCoverage(pythonCoverageFile);
  let linesHold = false;
  for (const f of sources) {
    const headText = fs.readFileSync(path.join(root, f.path), 'utf8');
    const changed = changedLines(f.base, headText);
    const hit = jsCovered.get(f.path) ?? pyCovered.get(f.path);
    if (!hit) continue;
    for (const l of hit) if (changed.has(l)) linesHold = true;
  }
  const oneHop = tests.length ? importsHold(tests, changedPaths, root) : false;
  return { condition: decideCondition({ linesHold, importsHold: oneHop }), linesHold, importsHold: oneHop, sawCoverage };
}

function isSource(p) {
  return ['.mjs', '.js', '.cjs', '.ts', '.py'].some((e) => p.endsWith(e)) && !/(^|\/)(test|tests|__tests__|__pycache__)\//.test(p) && !/\.(test|spec)\.[cm]?[jt]sx?$/.test(p) && !/(^|\/)test_[^/]*\.py$/.test(p) && !/(^|\/)[^/]*_test\.py$/.test(p);
}

function changedLines(baseText, headText) {
  const a = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'truedone-cov-')), 'base.txt');
  const b = path.join(path.dirname(a), 'head.txt');
  fs.writeFileSync(a, String(baseText ?? ''));
  fs.writeFileSync(b, String(headText ?? ''));
  let diff = '';
  try { diff = execFileSync('git', ['diff', '--no-index', '--unified=0', a, b], { encoding: 'utf8' }); } catch (e) { diff = e.stdout ?? ''; }
  const lines = new Set();
  for (const m of diff.matchAll(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm)) {
    const start = Number(m[1]);
    const count = m[2] === undefined ? 1 : Number(m[2]);
    for (let i = 0; i < Math.max(count, 1); i++) lines.add(start + i);
  }
  fs.rmSync(path.dirname(a), { recursive: true, force: true });
  return lines;
}

function readPythonCoverage(file) {
  const covered = new Map();
  if (!file || !fs.existsSync(file)) return covered;
  let data;
  try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return covered; }
  for (const [p, lines] of Object.entries(data)) covered.set(p, new Set(lines));
  return covered;
}
