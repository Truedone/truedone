// node tools/depmap-check.mjs [--base <rev>]: docs/DEPENDENCY-MAP.md's edge block holds the repository together.
// 1. every tracked or new (untracked, not ignored) file is in at least one node; 2. every node matches a tracked file unless it is planned, and a planned
// node that has files must drop "planned"; 3. every edge names a node; 4. for the change since the base (default: the
// merge-base with origin/main, plus the working tree), every changed node has each of its update targets changed too
// (a planned target has no file yet and is skipped); 5. the Nodes table and the diagram agree with the block (MAP-02).
// It prints, for every changed node, the nodes to review downstream and upstream. Written by gen-truedone.py (D28);
// no dependencies.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
const root = new URL('..', import.meta.url).pathname;
const git = (...a) => { try { return execFileSync('git', ['-C', root, ...a], { encoding: 'utf8' }).trim(); } catch { return null; } };
const text = fs.readFileSync(new URL('../docs/DEPENDENCY-MAP.md', import.meta.url), 'utf8');
const block = text.match(/```json depmap\n([\s\S]*?)```/);
if (!block) { console.log(JSON.stringify({ problems: ['docs/DEPENDENCY-MAP.md has no json depmap block'] })); process.exit(1); }
const map = JSON.parse(block[1]).nodes;
const glob = (g) => new RegExp('^' + g.split('**').map((p) => p.split('*').map((q) => q.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*')).join('.*') + '$');
const nodesOf = (f) => Object.entries(map).filter(([, n]) => n.paths.some((g) => glob(g).test(f))).map(([k]) => k);
const tracked = [...new Set([...(git('ls-files') || '').split('\n'), ...(git('ls-files', '--others', '--exclude-standard') || '').split('\n')])].filter(Boolean);
const problems = [];
for (const f of tracked) if (!nodesOf(f).length) problems.push(`unmapped file: ${f}`);
for (const [k, n] of Object.entries(map)) {
  const has = tracked.some((f) => n.paths.some((g) => glob(g).test(f)));
  if (!n.planned && !has) problems.push(`stale node ${k}: no tracked file matches ${n.paths.join(', ')}`);
  if (n.planned && has) problems.push(`node ${k} is marked planned but has files: drop "planned"`);
  for (const e of [...(n.update || []), ...(n.review || [])]) if (!map[e]) problems.push(`node ${k} names unknown node ${e}`);
}
// the reader view above the json block (v2e): every node has a row in the Nodes table and every edge is drawn in the diagram
const view = text.split('```json depmap')[0];
const mer = (view.match(/```mermaid\n([\s\S]*?)```/) || [])[1] || '';
const mid = (k) => k.replace(/-/g, '_');
for (const [k, n] of Object.entries(map)) {
  if (!view.split('\n').some((l) => l.startsWith('| \x60' + k + '\x60 |'))) problems.push(`the Nodes table has no row for ${k}`);
  for (const u of n.update || []) if (!mer.split('\n').some((l) => l.trim() === `${mid(k)} ==>|update| ${mid(u)}`)) problems.push(`the diagram does not draw the update edge ${k} -> ${u}`);
  for (const r of n.review || []) if (!mer.split('\n').some((l) => l.trim() === `${mid(k)} -.->|review| ${mid(r)}`)) problems.push(`the diagram does not draw the review edge ${k} -> ${r}`);
}
// MAP-02 (#135): the table and the diagram are views of the json block, and the check above reads only what the block
// names. So each node's row must carry the block's paths, required updates, reviews and status, a row must name a node the
// block has, and the diagram may draw only the update edges the block has. A difference fails, naming the node.
const cell = (xs) => (xs || []).map((x) => '\x60' + x + '\x60').join(', ');
const rows = new Map();
for (const l of view.split('\n')) {
  const m = /^\| \x60([^\x60]+)\x60 \|/.exec(l);
  if (!m) continue;
  if (rows.has(m[1])) problems.push(`the Nodes table has two rows for ${m[1]}`);
  rows.set(m[1], l.split('|').slice(1, -1).map((c) => c.trim()));
}
for (const [k, cells] of rows) {
  const n = map[k];
  if (!n) { problems.push(`the Nodes table has a row for ${k}, a node the json block does not have`); continue; }
  const want = [['paths', cell(n.paths)], ['must update', cell(n.update)], ['review', cell(n.review)], ['status', n.planned ? 'planned' : 'live']];
  want.forEach(([what, w], i) => {
    const got = cells[2 + i] ?? '';
    if (got !== w) problems.push(`the Nodes table row for ${k} has ${what} ${JSON.stringify(got)}, where the json block has ${JSON.stringify(w)}`);
  });
}
const byMid = new Map(Object.keys(map).map((k) => [mid(k), k]));
for (const l of mer.split('\n')) {
  const m = /^\s*(\S+) ==>\|update\| (\S+)\s*$/.exec(l);
  if (!m) continue;
  const k = byMid.get(m[1]), u = byMid.get(m[2]);
  if (!k || !u || !(map[k].update || []).includes(u)) problems.push(`the diagram draws the update edge ${k ?? m[1]} -> ${u ?? m[2]}, which the json block does not have`);
}
const at = process.argv.indexOf('--base');
const base = at > 0 ? process.argv[at + 1] : git('merge-base', 'HEAD', 'origin/main');
const lines = (s) => (s || '').split('\n').filter(Boolean);
const changed = new Set([...(base ? lines(git('diff', '--name-only', base, 'HEAD')) : []), ...lines(git('diff', '--name-only', 'HEAD')), ...lines(git('ls-files', '--others', '--exclude-standard'))]);
const changedNodes = new Set([...changed].flatMap(nodesOf));
const review = {};
for (const k of changedNodes) {
  for (const u of map[k].update || []) if (!changedNodes.has(u) && !map[u].planned) problems.push(`${k} changed, so ${u} (${map[u].paths.join(', ')}) must change in the same change`);
  const downstream = [...(map[k].update || []), ...(map[k].review || [])];
  const upstream = Object.entries(map).filter(([, n]) => [...(n.update || []), ...(n.review || [])].includes(k)).map(([x]) => x);
  review[k] = { downstream, upstream };
}
console.log(JSON.stringify({ base: base || null, changed_files: changed.size, changed_nodes: [...changedNodes], review, problems }));
process.exit(problems.length ? 1 : 0);
