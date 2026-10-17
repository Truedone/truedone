// node tools/readme-check.mjs (D30): README.md stays short and simple. At most 150 lines; under the title, a summary
// paragraph of at most 60 words; exactly one Mermaid flowchart; a "## Quick start" section of one to five numbered steps,
// each holding a command (inline code or a fenced block) or a link; no "safe" or "correct"; every relative link and
// image resolves to a file in the repository. Written by gen-truedone.py; no dependencies.
import fs from 'node:fs';
const root = new URL('..', import.meta.url);
const t = fs.readFileSync(new URL('README.md', root), 'utf8').replace(/\r/g, '');
const lines = t.replace(/\n$/, '').split('\n');
const gaps = [];
if (lines.length > 150) gaps.push(`README.md has ${lines.length} lines, more than 150`);
const body = t.replace(/^# .*\n+/, '');
const first = (body.split(/\n\s*\n/)[0] || '').trim();
if (!/^# /.test(t)) gaps.push('README.md does not start with a "# " title');
if (!first || /^(#|```|\||!\[|<)/.test(first)) gaps.push('README.md has no summary paragraph under the title');
else { const words = first.split(/\s+/).filter(Boolean).length; if (words > 60) gaps.push(`the summary paragraph has ${words} words, more than 60`); }
const flows = [...t.matchAll(/```mermaid\n([\s\S]*?)```/g)].filter((m) => /^(flowchart|graph)\b/.test(m[1].trim()));
if (flows.length !== 1) gaps.push(`README.md has ${flows.length} Mermaid flowcharts, not exactly one`);
const qs = t.match(/^## Quick start[ \t]*\n([\s\S]*?)(?=^## |$(?![\s\S]))/m);
if (!qs) gaps.push('README.md has no "## Quick start" section');
else {
  const steps = qs[1].split(/^(?=\d+\. )/m).filter((s) => /^\d+\. /.test(s));
  if (steps.length < 1 || steps.length > 5) gaps.push(`the quick start has ${steps.length} numbered steps, not one to five`);
  steps.forEach((s, i) => { if (!/`[^`]+`|```|\]\([^)]+\)/.test(s)) gaps.push(`quick start step ${i + 1} has no command or link`); });
}
const prose = t.replace(/```[\s\S]*?```/g, '').replace(/`[^`]*`/g, '');
const w = prose.match(/\b(safe|correct)\b/i);
if (w) gaps.push(`README.md uses the word "${w[1]}"`);
for (const m of t.matchAll(/!?\[[^\]]*\]\(([^)\s]+)\)/g)) {
  const href = m[1];
  if (/^(https?:|mailto:|#)/.test(href)) continue;
  const p = decodeURI(href.replace(/#.*$/, ''));
  if (p && !fs.existsSync(new URL(p.replace(/^\.\//, ''), root))) gaps.push(`README.md links to ${href}, which does not exist`);
}
console.log(JSON.stringify({ lines: lines.length, gaps }));
process.exit(gaps.length ? 1 : 0);
