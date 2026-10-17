// npx truedone init (CLI-02, PV-L07): appends the three-line snippet to AGENTS.md if it exists, else to CLAUDE.md if it
// exists, else creates AGENTS.md (docs/spec.md, cli and plugin). Existing lines are never edited or reordered: the
// file's bytes stay a prefix of the result. A line already present is not added again, so a second run writes nothing.
// It prints what it wrote.
import fs from 'node:fs';
import path from 'node:path';

export const SNIPPET = [
  '- Before reporting a task done, run `npx truedone` on the branch.',
  '- Never weaken, disable or delete a test to make it pass.',
  '- Report the verdict `npx truedone` printed, word for word.',
];

const CANDIDATES = ['AGENTS.md', 'CLAUDE.md'];

export function init(dir, { log = console.log } = {}) {
  const file = CANDIDATES.find((f) => fs.existsSync(path.join(dir, f))) ?? CANDIDATES[0];
  const full = path.join(dir, file);
  const existed = fs.existsSync(full);
  const before = existed ? fs.readFileSync(full, 'utf8') : '';
  const eol = before.includes('\r\n') ? '\r\n' : '\n';
  const present = new Set(before.split(/\r?\n/));
  const written = SNIPPET.filter((l) => !present.has(l));
  if (!written.length) {
    log(`${file}: the truedone lines are already there; nothing written`);
    return { file, written };
  }
  // a file that does not end in a newline gets one first, so its last line keeps its bytes; then one blank line
  const lead = before === '' ? '' : (before.endsWith('\n') ? '' : eol) + eol;
  fs.appendFileSync(full, lead + written.map((l) => l + eol).join(''));
  log(`${file}: ${existed ? 'appended' : 'created'} ${written.length} line${written.length === 1 ? '' : 's'}`);
  for (const l of written) log(`  ${l}`);
  return { file, written };
}
