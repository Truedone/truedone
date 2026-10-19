import fs from 'node:fs';
import path from 'node:path';

const repo = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

function args(argv) {
  const out = {
    src: path.join(repo, 'packages/core/src'),
    out: path.join(repo, 'packages/core/core.mjs'),
    copy: path.join(repo, 'packages/web/core.mjs'),
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--src') out.src = path.resolve(argv[++i]);
    else if (a === '--out') out.out = path.resolve(argv[++i]);
    else if (a === '--no-copy') out.copy = null;
    else {
      console.error(`unknown argument ${a}`);
      process.exit(1);
    }
  }
  return out;
}

function refuse(text) {
  console.error(`not a local named import: ${text.replace(/\s+/g, ' ').trim()}`);
  process.exit(1);
}

function splitImports(text) {
  const lines = text.split('\n');
  const imports = [];
  const body = [];
  let buf = null;
  for (const line of lines) {
    if (buf !== null) {
      buf += `\n${line}`;
      if (line.includes(';')) {
        imports.push(buf);
        buf = null;
      }
      continue;
    }
    if (/^\s*import\b/.test(line)) {
      if (line.includes(';')) imports.push(line);
      else buf = line;
    } else body.push(line);
  }
  if (buf !== null) imports.push(buf);
  return { imports, body: body.join('\n') };
}

const named = /^import\s*\{([^}]*)\}\s*from\s*(['"])(\.[^'"]+)\2\s*;?\s*$/;
const binding = /^([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/;

function parseImport(stmt, dir, src) {
  const m = named.exec(stmt.trim());
  if (!m) refuse(stmt);
  const spec = m[3];
  if (!spec.startsWith('.')) refuse(stmt);
  const target = path.resolve(dir, spec);
  const rel = path.relative(src, target);
  if (rel.startsWith('..') || path.isAbsolute(rel) || !target.endsWith('.mjs') || !fs.existsSync(target)) refuse(stmt);
  const aliases = [];
  for (const part of m[1].split(',')) {
    const bit = part.trim();
    if (!bit) continue;
    const b = binding.exec(bit);
    if (!b) refuse(stmt);
    if (b[2] && b[2] !== b[1]) aliases.push(`const ${b[2]} = ${b[1]};`);
  }
  return { target, aliases };
}

function orderOf(files, deps) {
  const waiting = new Map(files.map((f) => [f, new Set(deps.get(f) || [])]));
  const left = new Set(files);
  const out = [];
  while (left.size) {
    const ready = [...left].filter((f) => waiting.get(f).size === 0).sort();
    if (!ready.length) {
      console.error('import cycle');
      process.exit(1);
    }
    const next = ready[0];
    left.delete(next);
    out.push(next);
    for (const f of left) waiting.get(f).delete(next);
  }
  return out;
}

const BEFORE_REGEX = new Set(['(', '[', '{', ',', ';', '=', ':', '?', '!', '&', '|', '~', '^', '%', '+', '-', '*', '<', '>']);
const REGEX_WORD = new Set(['return', 'throw', 'case', 'delete', 'void', 'typeof', 'in', 'of', 'await', 'do', 'else', 'yield']);

function strip(code) {
  let i = 0;
  let out = '';
  const n = code.length;
  const mode = ['code'];
  const expr = [];
  let lineStart = true;
  let canRegex = true;
  let ident = '';
  const note = (ch) => {
    if (/[A-Za-z0-9_$]/.test(ch)) {
      ident += ch;
      return;
    }
    if (ident) {
      canRegex = REGEX_WORD.has(ident);
      ident = '';
    }
    if (ch === ' ' || ch === '\t') return;
    if (BEFORE_REGEX.has(ch)) canRegex = true;
    else canRegex = false;
  };
  const top = () => mode[mode.length - 1];
  while (i < n) {
    const m = top();
    if (m === 'code' && lineStart) {
      while (i < n && (code[i] === ' ' || code[i] === '\t')) i++;
      lineStart = false;
      if (i >= n) break;
    }
    const c = code[i];
    const d = code[i + 1];
    if (m === 'sq' || m === 'dq' || m === 'tpl') {
      if (c === '\\') {
        out += c + (d || '');
        i += 2;
        continue;
      }
      if (c === '\n') {
        out += c;
        i++;
        continue;
      }
      if (m === 'tpl' && c === '$' && d === '{') {
        out += '${';
        i += 2;
        mode.push('code');
        expr.push(0);
        canRegex = true;
        lineStart = false;
        continue;
      }
      const end = m === 'sq' ? "'" : m === 'dq' ? '"' : '`';
      out += c;
      i++;
      if (c === end) {
        mode.pop();
        canRegex = false;
      }
      continue;
    }
    if (m === 're') {
      if (c === '\\') {
        out += c + (d || '');
        i += 2;
        continue;
      }
      if (c === '\n') {
        out += c;
        i++;
        lineStart = true;
        continue;
      }
      out += c;
      i++;
      if (c === '/') {
        mode.pop();
        canRegex = false;
      }
      continue;
    }
    if (c === '\n') {
      out += c;
      i++;
      lineStart = true;
      canRegex = true;
      ident = '';
      continue;
    }
    if (c === '/' && d === '/') {
      while (i < n && code[i] !== '\n') i++;
      ident = '';
      continue;
    }
    if (c === '/' && d === '*') {
      i += 2;
      while (i < n && !(code[i] === '*' && code[i + 1] === '/')) {
        if (code[i] === '\n') {
          out += '\n';
          lineStart = true;
        }
        i++;
      }
      i += 2;
      ident = '';
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      mode.push(c === "'" ? 'sq' : c === '"' ? 'dq' : 'tpl');
      out += c;
      i++;
      continue;
    }
    if (c === '/' && canRegex) {
      mode.push('re');
      out += c;
      i++;
      continue;
    }
    if (c === '}' && expr.length && mode.length > 1 && mode[mode.length - 2] === 'tpl') {
      const depth = expr[expr.length - 1];
      if (depth === 0) {
        expr.pop();
        mode.pop();
        out += c;
        i++;
        canRegex = false;
        continue;
      }
      expr[expr.length - 1] = depth - 1;
    } else if (c === '{' && expr.length) {
      expr[expr.length - 1] += 1;
    }
    out += c;
    i++;
    note(c);
  }
  return out;
}

function takeExports(body) {
  const found = [];
  const out = [];
  for (const line of body.split('\n')) {
    const fn = /^(\s*)export\s+function\s+([A-Za-z_$][\w$]*)\b/.exec(line);
    if (fn) {
      found.push({ name: fn[2], kind: 'function' });
      out.push(line.replace(/^(\s*)export\s+/, '$1'));
      continue;
    }
    const decl = /^(\s*)export\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)\b/.exec(line);
    if (decl) {
      found.push({ name: decl[2], kind: 'const' });
      out.push(line.replace(/^(\s*)export\s+/, '$1'));
      continue;
    }
    if (/^\s*export\b/.test(line)) refuse(line);
    out.push(line);
  }
  return { found, body: out.join('\n') };
}

// A module's export list, one name per line (PLG-11): the plugin directory's scanner could not read a 349-character
// line of the plugin's hook file, the brace list a bundled module returns, and held the plugin for it. Only line
// breaks are added, so with them removed every bundle is byte for byte what it was; lines from the sources stay as
// their authors wrote them.
function exportList(names) {
  return `return {${names.map((n) => `\n${n}`).join(',')}\n};`;
}

function build(src) {
  const names = fs.readdirSync(src).filter((n) => n.endsWith('.mjs')).sort();
  const files = names.map((n) => path.join(src, n));
  const deps = new Map();
  const parts = new Map();
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    const { imports, body } = splitImports(text);
    const mine = [];
    const aliases = [];
    for (const stmt of imports) {
      const parsed = parseImport(stmt, path.dirname(file), src);
      mine.push(parsed.target);
      aliases.push(...parsed.aliases);
    }
    deps.set(file, mine);
    parts.set(file, { aliases, ...takeExports(body) });
  }
  const seen = new Set();
  const chunks = [];
  for (const file of orderOf(files, deps)) {
    const id = `__bundle_${path.basename(file, '.mjs').replace(/[^A-Za-z0-9_]/g, '_')}`;
    const part = parts.get(file);
    const head = part.aliases.length ? `${part.aliases.join('\n')}\n` : '';
    const inner = strip(`${head}${part.body}`).replace(/^\n+/, '');
    chunks.push(`const ${id}=(()=>{\n${inner}\n${exportList(part.found.map((e) => e.name))}\n})();\n`);
    for (const e of part.found) {
      if (seen.has(e.name)) {
        console.error(`duplicate export ${e.name}`);
        process.exit(1);
      }
      seen.add(e.name);
      chunks.push(e.kind === 'function'
        ? `export function ${e.name}(...a){return ${id}.${e.name}(...a)}\n`
        : `export const ${e.name}=${id}.${e.name};\n`);
    }
  }
  return chunks.join('');
}

const opt = args(process.argv.slice(2));
const text = `${build(opt.src).replace(/\n{3,}/g, '\n\n').trim()}\n`;
fs.mkdirSync(path.dirname(opt.out), { recursive: true });
fs.writeFileSync(opt.out, text);
if (opt.copy) {
  fs.mkdirSync(path.dirname(opt.copy), { recursive: true });
  fs.writeFileSync(opt.copy, text);
}

// Entry bundles (CLI-01, PLG-01): the published CLI file and the plugin's hook file, each one ES module with no import
// but node: built-ins. The run with no arguments builds them after core.mjs. Each module the entry reaches through a
// relative import becomes one function scope that returns its exports; an importer takes the names it imports from
// that object, so two modules may export the same name. node: imports are hoisted once to the top; two modules may
// not bind one local name to different built-ins. core.mjs, already one file, is taken as it is. A shebang on the entry
// stays the first line. The entry's own lines stay at the top level, so a line such as const REDGREEN_ENABLED = false;
// keeps its exact text (PLG-03 sets it from docs/gates/redgreen.json, D17). The release's version, packages/cli/
// package.json's (REL-P1), is written into every bundle: the CLI's line const VERSION = '...'; and, in each bundle that
// carries core/run's report writer, its line const TRUEDONE_VERSION = '...';, so the CLI, the plugin's Stop hook and the
// action report the release they are.
const RELEASE = 'packages/cli/package.json';
const ENTRIES = [
  { entry: 'packages/cli/src/bin.mjs', out: 'packages/cli/truedone.mjs', version: true },
  { entry: 'packages/cli/src/plugin/entry.mjs', out: 'packages/cli/plugin/hooks/stop.mjs', redgreen: 'docs/gates/redgreen.json' },
  { entry: 'packages/action/src/index.mjs', out: 'packages/action/dist/index.mjs' }, // the action entry (ACT-01)
];

function entryBundle(entryRel, { redgreen, version } = {}) {
  const entry = path.join(repo, entryRel);
  const builtins = new Map();   // local name -> import statement
  const order = [];
  const seen = new Map();       // file -> module id
  const bodies = new Map();
  let shebang = '';
  const builtin = (stmt, file) => {
    const m = /^import\s+(.+?)\s+from\s+(['"])(node:[a-z_/]+)\2\s*;?\s*$/.exec(stmt.replace(/\s+/g, ' ').trim());
    if (!m) return false;
    const clause = m[1];
    const def = /^([A-Za-z_$][\w$]*)\s*(,|$)/.exec(clause);
    const ns = /\*\s+as\s+([A-Za-z_$][\w$]*)/.exec(clause);
    const braces = /\{([^}]*)\}/.exec(clause);
    // one import statement per local name, so the same name imported in two modules is declared once
    const specs = [];
    if (def) specs.push([def[1], `import ${def[1]} from '${m[3]}';`]);
    if (ns) specs.push([ns[1], `import * as ${ns[1]} from '${m[3]}';`]);
    if (braces) for (const part of braces[1].split(',')) { const b2 = part.trim(); if (b2) specs.push([(b2.split(/\s+as\s+/)[1] || b2).trim(), `import { ${b2} } from '${m[3]}';`]); }
    for (const [n, one] of specs) {
      const prev = builtins.get(n);
      if (prev && prev !== one) { console.error(`${path.relative(repo, file)}: ${n} is bound to two built-ins (${prev} / ${one})`); process.exit(1); }
      builtins.set(n, one);
    }
    return true;
  };
  const visit = (file) => {
    if (seen.has(file)) return seen.get(file);
    const id = `__m${seen.size}`;
    seen.set(file, id);
    let text = fs.readFileSync(file, 'utf8');
    if (file === entry && text.startsWith('#!')) { shebang = text.slice(0, text.indexOf('\n') + 1); text = text.slice(shebang.length); }
    const { imports, body } = splitImports(text);
    const takes = [];
    for (const stmt of imports) {
      if (builtin(stmt, file)) continue;
      const m = /^import\s*\{([^}]*)\}\s*from\s*(['"])(\.[^'"]+\.mjs)\2\s*;?\s*$/.exec(stmt.replace(/\s+/g, ' ').trim());
      if (!m) refuse(stmt);
      const target = path.resolve(path.dirname(file), m[3]);
      if (!target.startsWith(repo + path.sep) || !fs.existsSync(target)) refuse(stmt);
      const dep = visit(target);
      const binds = m[1].split(',').map((s) => s.trim()).filter(Boolean).map((b) => { const mm = /^([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/.exec(b); if (!mm) refuse(stmt); return mm[2] ? `${mm[1]}: ${mm[2]}` : mm[1]; });
      takes.push(`const { ${binds.join(', ')} } = ${dep};`);
    }
    const exp = [];
    const lines = body.split('\n').map((line) => {
      const mm = /^(\s*)export\s+((?:async\s+)?function\*?|class|const|let|var)\s+([A-Za-z_$][\w$]*)/.exec(line);
      if (mm) { exp.push(mm[3]); return line.replace(/^(\s*)export\s+/, '$1'); }
      // a one-line export { a, b as c }; of names already in scope is returned too; export { } from is not taken
      const ml = /^\s*export\s*\{([^}]*)\}\s*;?\s*$/.exec(line);
      if (ml) {
        for (const part of ml[1].split(',').map((s) => s.trim()).filter(Boolean)) {
          const m2 = /^([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/.exec(part);
          if (!m2) refuse(line);
          exp.push(m2[2] ? `${m2[2]}: ${m2[1]}` : m2[1]);
        }
        return '';
      }
      if (/^\s*export\b/.test(line)) refuse(line);
      return line;
    });
    bodies.set(file, { id, takes, body: lines.join('\n'), exp });
    order.push(file);
    return id;
  };
  visit(entry);
  let out = shebang + [...builtins.values()].join('\n') + '\n';
  for (const file of order) {
    const { id, takes, body, exp } = bodies.get(file);
    const inner = strip(`${takes.join('\n')}\n${body}`).replace(/^\n+/, '');
    if (file === entry) out += `${inner}\n`;
    else out += `const ${id}=(()=>{\n${inner}\n${exportList(exp)}\n})();\n`;
  }
  if (redgreen) {
    let on = false;
    try { on = JSON.parse(fs.readFileSync(path.join(repo, redgreen), 'utf8')).pass === true; } catch { /* no gate record yet: off */ }
    const line = /^const REDGREEN_ENABLED = (true|false);$/m;
    if (!line.test(out)) { console.error(`${entryRel}: no line const REDGREEN_ENABLED = false; to set`); process.exit(1); }
    out = out.replace(line, `const REDGREEN_ENABLED = ${on};`);
  }
  const v = JSON.parse(fs.readFileSync(path.join(repo, RELEASE), 'utf8')).version;
  if (!/^\d+\.\d+\.\d+$/.test(String(v))) { console.error(`${RELEASE}: version ${v} is not major.minor.patch`); process.exit(1); }
  const set = (name, required) => {
    const line = new RegExp(`^const ${name} = '[^']*';$`, 'gm');
    const n = (out.match(line) || []).length;
    if (n > 1 || (required && n !== 1)) { console.error(`${entryRel}: ${n} lines const ${name} = '...'; to set, not one`); process.exit(1); }
    out = out.replace(line, `const ${name} = '${v}';`);
  };
  if (version) set('VERSION', true);
  // a bundle that carries core/run's report writer carries its version line
  set('TRUEDONE_VERSION', out.includes('truedone_version: TRUEDONE_VERSION'));
  return `${out.replace(/\n{3,}/g, '\n\n').trim()}\n`;
}

if (!process.argv.slice(2).length) {
  for (const e of ENTRIES) {
    if (!fs.existsSync(path.join(repo, e.entry))) continue;
    const text = entryBundle(e.entry, e);
    fs.mkdirSync(path.dirname(path.join(repo, e.out)), { recursive: true });
    fs.writeFileSync(path.join(repo, e.out), text);
  }
}
