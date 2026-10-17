// node tools/docs-check.mjs (D29): every section of docs/spec.md, the decisions and the requirements list excepted, has a
// document under docs/design/ that names it ("Source section: <heading>"), with a "## Flow" and a "## Schematic" heading
// each followed by a Mermaid diagram, and a link back to 00-master.md; docs/design/00-master.md has a Mermaid master
// schematic with a node for every section document (its file name without .md) and a link to each. Written by
// gen-truedone.py; no dependencies.
import fs from 'node:fs';
const root = new URL('..', import.meta.url);
const read = (p) => fs.readFileSync(new URL(p, root), 'utf8');
const KINDS = /^(flowchart|graph|sequenceDiagram|stateDiagram(-v2)?|classDiagram|erDiagram|C4\w*|block-beta|architecture-beta|journey|timeline|mindmap|quadrantChart|gantt|pie)\b/;
const SKIP = new Set(['Decisions to confirm', 'Requirements']);
const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const sections = [...read('docs/spec.md').matchAll(/^## (.+)$/gm)].map((m) => m[1].trim()).filter((x) => !SKIP.has(x));
const dir = new URL('docs/design/', root);
const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((x) => x.endsWith('.md')).sort() : [];
const docs = Object.fromEntries(files.map((x) => [x, read(`docs/design/${x}`)]));
const gaps = [];
const diagramAfter = (text, heading) => { const i = text.search(new RegExp(`^## ${heading}\\s*$`, 'm')); if (i < 0) return null; const m = text.slice(i).match(/```mermaid\n([\s\S]*?)```/); return m && KINDS.test(m[1].trim()) ? m[1] : null; };
const found = [];
for (const sec of sections) {
  const f = files.find((x) => x !== '00-master.md' && new RegExp(`^Source section: ${esc(sec)}\\s*$`, 'm').test(docs[x]));
  if (!f) { gaps.push(`no document under docs/design/ says "Source section: ${sec}"`); continue; }
  found.push(f);
  if (!diagramAfter(docs[f], 'Flow')) gaps.push(`${f}: no Mermaid diagram under "## Flow"`);
  if (!diagramAfter(docs[f], 'Schematic')) gaps.push(`${f}: no Mermaid diagram under "## Schematic"`);
  if (!/\]\(\.?\/?00-master\.md\)/.test(docs[f])) gaps.push(`${f}: no link back to 00-master.md`);
}
const master = docs['00-master.md'];
if (!master) gaps.push('docs/design/00-master.md is missing');
else {
  const m = master.match(/```mermaid\n([\s\S]*?)```/);
  if (!m || !KINDS.test(m[1].trim())) gaps.push('00-master.md: no Mermaid master schematic');
  for (const f of found) {
    const id = f.replace(/\.md$/, '');
    if (!m || !new RegExp(`(^|[^\\w-])${esc(id)}([^\\w-]|$)`).test(m[1])) gaps.push(`00-master.md: the master schematic has no node ${id}`);
    if (!new RegExp(`\\]\\(\\.?\\/?${esc(f)}\\)`).test(master)) gaps.push(`00-master.md: no link to ${f}`);
  }
}
console.log(JSON.stringify({ sections: sections.length, documents: found.length, gaps }));
process.exit(gaps.length ? 1 : 0);
