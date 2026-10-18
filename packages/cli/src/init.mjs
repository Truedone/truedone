// npx truedone init (CLI-02, PV-L07): appends the snippet to AGENTS.md if it exists, else to CLAUDE.md if it exists, else
// creates AGENTS.md (docs/spec.md, cli and plugin). Existing lines are never edited or reordered: the file's bytes stay a
// prefix of the result. A line already present is not added again, so a second run writes nothing. It prints what it wrote.
// init --global (D38) writes the same lines by the same rule to the developer's own agent files: ~/.claude/CLAUDE.md, created
// when missing, and ~/.codex/AGENTS.md when ~/.codex exists, so the lines travel to every repository the developer works in.
import fs from 'node:fs';
import path from 'node:path';

export const SNIPPET = [
  '- Before reporting a task done, run `npx truedone` on the branch.',
  '- Never weaken, disable or delete a test to make it pass.',
  '- Report the verdict `npx truedone` printed, word for word.',
  '- Put the line `npx truedone --pr-line` prints in the pull request description.',
];

const CANDIDATES = ['AGENTS.md', 'CLAUDE.md'];

// Appends the snippet lines missing from one file, by init's rule; name is how the file is printed
function appendSnippet(full, name, log) {
  const existed = fs.existsSync(full);
  const before = existed ? fs.readFileSync(full, 'utf8') : '';
  const eol = before.includes('\r\n') ? '\r\n' : '\n';
  const present = new Set(before.split(/\r?\n/));
  const written = SNIPPET.filter((l) => !present.has(l));
  if (!written.length) {
    log(`${name}: the truedone lines are already there; nothing written`);
    return { file: name, written };
  }
  // a file that does not end in a newline gets one first, so its last line keeps its bytes; then one blank line
  const lead = before === '' ? '' : (before.endsWith('\n') ? '' : eol) + eol;
  fs.appendFileSync(full, lead + written.map((l) => l + eol).join(''));
  log(`${name}: ${existed ? 'appended' : 'created'} ${written.length} line${written.length === 1 ? '' : 's'}`);
  for (const l of written) log(`  ${l}`);
  return { file: name, written };
}

export function init(dir, { log = console.log } = {}) {
  const file = CANDIDATES.find((f) => fs.existsSync(path.join(dir, f))) ?? CANDIDATES[0];
  return appendSnippet(path.join(dir, file), file, log);
}

export function initGlobal(home, { log = console.log } = {}) {
  const claude = path.join(home, '.claude');
  fs.mkdirSync(claude, { recursive: true });
  const out = [appendSnippet(path.join(claude, 'CLAUDE.md'), '~/.claude/CLAUDE.md', log)];
  const codex = path.join(home, '.codex');
  if (fs.existsSync(codex) && fs.statSync(codex).isDirectory()) out.push(appendSnippet(path.join(codex, 'AGENTS.md'), '~/.codex/AGENTS.md', log));
  return out;
}
