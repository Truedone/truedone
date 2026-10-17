// Coverage condition (RUN-04, D8). Node writes V8 coverage when NODE_V8_COVERAGE
// is set. Python uses a pytest plugin written into a temporary directory:
// sys.monitoring on 3.12 and later, sys.settrace below. When no coverage is
// collected, a changed file imported by the test, directly or one hop away,
// counts as imports. A second hop does not.
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PLUGIN = `import json, os, sys
HITS = set()

def _on_line(code, line):
    HITS.add((code.co_filename, line))

def _trace(frame, event, arg):
    if event == "line":
        HITS.add((frame.f_code.co_filename, frame.f_lineno))
    return _trace

def pytest_configure(config):
    if hasattr(sys, "monitoring"):
        tool = sys.monitoring.PROFILER_ID
        sys.monitoring.use_tool_id(tool, "tdcov")
        sys.monitoring.register_callback(tool, sys.monitoring.events.LINE, _on_line)
        sys.monitoring.set_events(tool, sys.monitoring.events.LINE)
        return
    sys.settrace(_trace)

def pytest_unconfigure(config):
    out = os.environ.get("TD_COV_OUT")
    if not out:
        return
    rows = [{"file": name, "line": line} for name, line in sorted(HITS)]
    with open(out, "w", encoding="utf-8") as handle:
        json.dump(rows, handle)
`;

export function linesFromPatch(patch) {
  const lines = new Set();
  let next = 0;
  for (const raw of String(patch || '').split('\n')) {
    const hunk = raw.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk) {
      next = Number(hunk[1]);
      continue;
    }
    if (!next) continue;
    if (raw.startsWith('+') && !raw.startsWith('+++')) {
      lines.add(next);
      next += 1;
      continue;
    }
    if (raw.startsWith('-') && !raw.startsWith('---')) continue;
    if (raw.startsWith('\\')) continue;
    next += 1;
  }
  return lines;
}

function linesFromTexts(before, after) {
  const left = String(before).split('\n');
  const right = String(after).split('\n');
  const lines = new Set();
  const count = Math.max(left.length, right.length);
  for (let i = 0; i < count; i += 1) if (left[i] !== right[i]) lines.add(i + 1);
  return lines;
}

function changedFiles(root, files) {
  const out = [];
  for (const file of files || []) {
    if (!file?.path) continue;
    let lines = new Set();
    if (file.patch) lines = linesFromPatch(file.patch);
    else if (typeof file.base === 'string') {
      const abs = path.join(root, file.path);
      if (existsSync(abs)) lines = linesFromTexts(file.base, readFileSync(abs, 'utf8'));
    }
    if (!lines.size) continue;
    out.push({ path: file.path.split(path.sep).join('/'), abs: locate(root, path.resolve(root, file.path)), lines });
  }
  return out;
}

export function coverageEnv(files) {
  if (!(files || []).some((file) => file?.path)) return null;
  const dir = mkdtempSync(path.join(tmpdir(), 'td-cov-'));
  const nodeDir = path.join(dir, 'node');
  mkdirSync(nodeDir);
  writeFileSync(path.join(dir, 'td_cov.py'), PLUGIN);
  const pyOut = path.join(dir, 'py.json');
  return {
    dir,
    pyOut,
    env: {
      NODE_V8_COVERAGE: nodeDir,
      PYTHONPATH: dir,
      TD_COV_OUT: pyOut,
      PYTEST_ADDOPTS: '-p td_cov',
    },
    cleanup() {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

function lineIndex(text, offset) {
  let line = 0;
  const end = Math.min(offset, text.length);
  for (let i = 0; i < end; i += 1) if (text[i] === '\n') line += 1;
  return line;
}

function decodeVlq(segment) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const values = [];
  let cur = 0;
  let shift = 0;
  for (const ch of segment) {
    const raw = alphabet.indexOf(ch);
    if (raw < 0) continue;
    const cont = raw & 32;
    const digit = raw & 31;
    cur += digit << shift;
    if (cont) {
      shift += 5;
      continue;
    }
    const neg = cur & 1;
    cur >>= 1;
    values.push(neg ? -cur : cur);
    cur = 0;
    shift = 0;
  }
  return values;
}

function locate(root, file) {
  const abs = path.isAbsolute(file) ? file : path.resolve(root || '', file);
  try { return realpathSync(abs); } catch { return path.resolve(abs); }
}

function addHit(into, abs, line) {
  if (!into.has(abs)) into.set(abs, new Set());
  into.get(abs).add(line);
}

function mapSourceLines(jsAbs, zeroBased) {
  let text = '';
  try { text = readFileSync(jsAbs, 'utf8'); } catch { return; }
  const mark = text.match(/[#@]\s*sourceMappingURL=(\S+)/);
  if (!mark || mark[1].startsWith('data:')) return;
  const mapPath = path.resolve(path.dirname(jsAbs), mark[1]);
  if (!existsSync(mapPath)) return;
  let map;
  try { map = JSON.parse(readFileSync(mapPath, 'utf8')); } catch { return; }
  const generated = String(map.mappings || '').split(';');
  const sources = map.sources || [];
  let srcFile = 0;
  let srcLine = 0;
  const mapped = new Map();
  for (let line = 0; line < generated.length; line += 1) {
    for (const seg of generated[line].split(',')) {
      if (!seg) continue;
      const fields = decodeVlq(seg);
      if (fields.length >= 4) {
        srcFile += fields[1];
        srcLine += fields[2];
      }
    }
    if (!zeroBased.has(line)) continue;
    const source = sources[srcFile];
    if (!source) continue;
    addHit(mapped, path.resolve(path.dirname(mapPath), source), srcLine + 1);
  }
  return mapped;
}

function readHits(dir, root) {
  const lines = new Map();
  let collected = false;
  const nodeDir = path.join(dir, 'node');
  if (existsSync(nodeDir)) {
    for (const name of readdirSync(nodeDir)) {
      if (!name.endsWith('.json')) continue;
      collected = true;
      let json;
      try { json = JSON.parse(readFileSync(path.join(nodeDir, name), 'utf8')); } catch { continue; }
      for (const script of json.result || []) {
        let abs;
        try { abs = fileURLToPath(script.url); } catch { continue; }
        let text = '';
        try { text = readFileSync(abs, 'utf8'); } catch { continue; }
        const zero = new Set();
        for (const fn of script.functions || []) {
          for (const range of fn.ranges || []) {
            if (!range.count) continue;
            const start = lineIndex(text, range.startOffset);
            const end = lineIndex(text, Math.max(range.startOffset, (range.endOffset || range.startOffset) - 1));
            for (let n = start; n <= end; n += 1) zero.add(n);
          }
        }
        for (const n of zero) addHit(lines, locate(root, abs), n + 1);
        const mapped = mapSourceLines(abs, zero);
        if (!mapped) continue;
        for (const [source, set] of mapped) {
          for (const n of set) addHit(lines, source, n);
        }
      }
    }
  }
  const pyOut = path.join(dir, 'py.json');
  if (existsSync(pyOut)) {
    collected = true;
    let rows = [];
    try { rows = JSON.parse(readFileSync(pyOut, 'utf8')); } catch { rows = []; }
    for (const row of rows) addHit(lines, locate(root, row.file), row.line);
  }
  return { collected, lines };
}

function specsOf(text, python) {
  const found = [];
  if (python) {
    for (const match of text.matchAll(/^\s*from\s+(\.*[\w.]*)\s+import|^\s*import\s+(\.*[\w.]*)/gm)) {
      found.push(match[1] || match[2]);
    }
    return found;
  }
  for (const match of text.matchAll(/\bfrom\s+['"]([^'"]+)['"]|\bimport\s+['"]([^'"]+)['"]|\brequire\(\s*['"]([^'"]+)['"]\s*\)|\bimport\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    found.push(match[1] || match[2] || match[3] || match[4]);
  }
  return found;
}

function resolveSpec(root, fromRel, spec) {
  const python = fromRel.endsWith('.py');
  if (python) {
    if (!spec.startsWith('.')) {
      const plain = path.resolve(root, path.dirname(fromRel), `${spec.split('.')[0]}.py`);
      return existsSync(plain) ? path.relative(root, plain).split(path.sep).join('/') : null;
    }
    const parts = spec.split('.');
    let dir = path.resolve(root, path.dirname(fromRel));
    let i = 0;
    while (parts[i] === '') {
      if (i > 0) dir = path.dirname(dir);
      i += 1;
    }
    const name = parts.slice(i).filter(Boolean).join('/');
    const abs = path.resolve(dir, name ? `${name}.py` : '');
    return existsSync(abs) ? path.relative(root, abs).split(path.sep).join('/') : null;
  }
  if (!spec.startsWith('.')) return null;
  const base = path.resolve(root, path.dirname(fromRel), spec);
  const tries = [base, `${base}.js`, `${base}.mjs`, `${base}.cjs`, `${base}.py`, path.join(base, 'index.js')];
  for (const abs of tries) {
    if (existsSync(abs) && statSync(abs).isFile()) return path.relative(root, abs).split(path.sep).join('/');
  }
  return null;
}

export function importsHit(root, testPath, changedPaths) {
  const wanted = new Set(changedPaths.map((item) => item.split(path.sep).join('/')));
  const python = testPath.endsWith('.py');
  const abs = path.join(root, testPath);
  if (!existsSync(abs)) return false;
  let text = '';
  try { text = readFileSync(abs, 'utf8'); } catch { return false; }
  const direct = specsOf(text, python).map((spec) => resolveSpec(root, testPath, spec)).filter(Boolean);
  for (const item of direct) if (wanted.has(item)) return true;
  for (const item of direct) {
    let inner = '';
    try { inner = readFileSync(path.join(root, item), 'utf8'); } catch { continue; }
    const next = specsOf(inner, item.endsWith('.py')).map((spec) => resolveSpec(root, item, spec)).filter(Boolean);
    for (const hop of next) if (wanted.has(hop)) return true;
  }
  return false;
}

export function conditionsFor({ root, cov, files, tests }) {
  const changed = changedFiles(root, files);
  const hits = cov ? readHits(cov.dir, root) : { collected: false, lines: new Map() };
  let linesHit = false;
  if (hits.collected) {
    for (const file of changed) {
      const got = hits.lines.get(file.abs);
      if (!got) continue;
      for (const line of file.lines) if (got.has(line)) linesHit = true;
    }
  }
  const byPath = new Map();
  for (const test of tests || []) {
    const testPath = test.test || test.file;
    if (!testPath) continue;
    let condition = 'none';
    if (hits.collected) condition = linesHit ? 'lines' : 'none';
    else if (importsHit(root, testPath, changed.map((file) => file.path))) condition = 'imports';
    byPath.set(testPath, condition);
  }
  return { collected: hits.collected, linesHit, byPath };
}

export function conditionForEntry(info, entry, tests) {
  if (!info) return 'none';
  if (info.collected) return info.linesHit ? 'lines' : 'none';
  const file = entry?.file || '';
  for (const test of tests || []) {
    const testPath = test.test || test.file || '';
    if (!testPath) continue;
    if (file === testPath || file.endsWith(`/${testPath}`) || file.endsWith(test.file || '\0')) {
      return info.byPath.get(testPath) || 'none';
    }
  }
  if ((tests || []).length === 1) return info.byPath.get(tests[0].test || tests[0].file) || 'none';
  return 'none';
}

export function coveredUrl(abs) {
  return pathToFileURL(abs).href;
}
