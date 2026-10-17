// classify(path, context) follows the file classification table. First match wins.
// Config text arrives in context. This file does not read the disk.

const LOCKS = new Set(['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'poetry.lock', 'uv.lock', 'Pipfile.lock']);
const DEP_KEYS = new Set(['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies', 'bundledDependencies', 'bundleDependencies']);
const JS_EXT = new Set(['js', 'jsx', 'mjs', 'cjs', 'ts', 'tsx', 'mts', 'cts']);

function norm(p) {
  return String(p || '').replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
}

function baseName(p) {
  const i = p.lastIndexOf('/');
  return i < 0 ? p : p.slice(i + 1);
}

function segments(p) {
  return p.split('/').filter(Boolean);
}

function extOf(p) {
  const b = baseName(p);
  const i = b.lastIndexOf('.');
  return i < 0 ? '' : b.slice(i + 1);
}

function isJsPath(p) {
  return JS_EXT.has(extOf(p));
}

function under(p, name) {
  return segments(p).includes(name);
}

function hasKey(keys, pred) {
  return keys.some(pred);
}

function asList(v) {
  if (typeof v === 'string') return [v];
  if (Array.isArray(v)) return v.filter((x) => typeof x === 'string');
  return [];
}

function splitWords(v) {
  return String(v).split(/\s+/).map((s) => s.trim()).filter(Boolean);
}

function globToReg(pattern) {
  let src = '';
  for (let i = 0; i < pattern.length;) {
    if (pattern.startsWith('**/', i)) { src += '(?:.*/)?'; i += 3; continue; }
    if (pattern.startsWith('**', i)) { src += '.*'; i += 2; continue; }
    if (pattern[i] === '*') { src += '[^/]*'; i += 1; continue; }
    const c = pattern[i];
    src += /[.+?^${}()|[\]\\]/.test(c) ? `\\${c}` : c;
    i += 1;
  }
  return new RegExp(`^${src}$`);
}

function globMatch(pattern, p) {
  return globToReg(pattern).test(p);
}

function nameMatch(pattern, name) {
  const body = pattern.split('*').map((q) => q.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*');
  return new RegExp(`^${body}$`).test(name);
}

function jsonDocs(configs) {
  const docs = [];
  for (const c of configs) {
    if (!c || typeof c.path !== 'string' || typeof c.text !== 'string') continue;
    const p = norm(c.path);
    if (isJsPath(p) || !p.endsWith('.json')) continue;
    try {
      docs.push(JSON.parse(c.text));
    } catch {
      // A config that does not parse contributes no pattern.
    }
  }
  return docs;
}

function patternsFrom(configs) {
  const testMatch = [];
  const pythonFiles = [];
  const setup = [];
  for (const doc of jsonDocs(configs)) {
    testMatch.push(...asList(doc.testMatch));
    setup.push(...asList(doc.setupFiles), ...asList(doc.setupFilesAfterEnv), ...asList(doc.require));
  }
  for (const c of configs) {
    if (!c || typeof c.path !== 'string' || typeof c.text !== 'string') continue;
    const p = norm(c.path);
    if (isJsPath(p)) continue;
    if (p.endsWith('.toml')) pythonFiles.push(...tomlPythonFiles(c.text));
    else if (p.endsWith('.ini') || p.endsWith('.cfg')) pythonFiles.push(...iniPythonFiles(c.text));
  }
  return { testMatch, pythonFiles, setup: setup.map(norm) };
}

function iniPythonFiles(text) {
  const out = [];
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith(';') || line.startsWith('[')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    if (line.slice(0, eq).trim() !== 'python_files') continue;
    out.push(...splitWords(line.slice(eq + 1)));
  }
  return out;
}

function tomlPythonFiles(text) {
  const out = [];
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    const m = line.match(/^python_files\s*=\s*(.+)$/);
    if (!m) continue;
    const v = m[1].trim();
    if (v.startsWith('[')) {
      for (const q of v.match(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g) || []) out.push(q.slice(1, -1));
    } else if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      out.push(...splitWords(v.slice(1, -1)));
    }
  }
  return out;
}

function runnerKey(k) {
  return k === 'jest' || k.startsWith('jest.') || k === 'scripts.test' || k.startsWith('scripts.test.');
}

function pytestKey(k) {
  return k === 'tool.pytest.ini_options' || k.startsWith('tool.pytest.ini_options.');
}

function depKey(k) {
  return DEP_KEYS.has(k) || k.endsWith('.dependencies') || k.includes('optional-dependencies') || k.startsWith('dependency-groups');
}

function isRunner(path, base, keys) {
  if (/^(jest|vitest|vite)\.config\./.test(base)) return true;
  if (base.startsWith('.mocharc.')) return true;
  if (base === 'pytest.ini' || base === 'tox.ini' || base === 'setup.cfg') return true;
  if (base === 'pyproject.toml' && hasKey(keys, pytestKey)) return true;
  if ((path === 'package.json' || base === 'package.json') && hasKey(keys, runnerKey)) return true;
  return false;
}

function isSetup(path, base, setupPaths) {
  if (base === 'conftest.py') return true;
  if (/^(jest|vitest)\.setup\./.test(base)) return true;
  if (base.startsWith('setup-tests.')) return true;
  return setupPaths.includes(path);
}

function isTest(path, base, found) {
  const ext = extOf(path);
  if (JS_EXT.has(ext)) {
    if (/\.test\./.test(base) || /\.spec\./.test(base)) return true;
    if (under(path, 'test') || under(path, 'tests') || under(path, '__tests__')) return true;
  }
  if (ext === 'py') {
    if (base.startsWith('test_') || base.endsWith('_test.py')) return true;
    if (under(path, 'tests')) return true;
  }
  if (found.testMatch.some((g) => globMatch(g, path))) return true;
  if (ext === 'py' && found.pythonFiles.some((g) => nameMatch(g, base))) return true;
  return false;
}

function isHelper(path, base) {
  if (base.endsWith('.snap')) return true;
  if (under(path, '__snapshots__') || under(path, 'fixtures')) return true;
  if (under(path, 'test') || under(path, 'tests') || under(path, '__tests__')) return true;
  return false;
}

function isManifest(path, base, keys) {
  if (/^requirements.*\.txt$/.test(base)) return true;
  if (base === 'package.json' && hasKey(keys, depKey)) return true;
  if (base === 'pyproject.toml' && hasKey(keys, depKey)) return true;
  return false;
}

function isDocs(path, base) {
  if (base.endsWith('.md') || base.endsWith('.rst')) return true;
  if (under(path, 'docs')) return true;
  if (base.startsWith('LICENSE') || base.startsWith('CHANGELOG')) return true;
  return false;
}

export function classify(filePath, context = {}) {
  const path = norm(filePath);
  const base = baseName(path);
  const keys = Array.isArray(context.keys) ? context.keys.filter((k) => typeof k === 'string') : [];
  const found = patternsFrom(Array.isArray(context.configs) ? context.configs : []);
  if (path === '.github/proved.yml') return 'proved_config';
  if (/^\.github\/workflows\/[^/]+\.ya?ml$/.test(path)) return 'workflow';
  if (isRunner(path, base, keys)) return 'runner_config';
  if (isSetup(path, base, found.setup)) return 'setup';
  if (isTest(path, base, found)) return 'test';
  if (isHelper(path, base)) return 'test_helper';
  if (LOCKS.has(base)) return 'lockfile';
  if (isManifest(path, base, keys)) return 'dependency_manifest';
  if (isDocs(path, base)) return 'docs';
  return 'source';
}
