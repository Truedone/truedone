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
    const ret = part.found.map((e) => e.name).join(',');
    chunks.push(`const ${id}=(()=>{\n${inner}\nreturn {${ret}};\n})();\n`);
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
