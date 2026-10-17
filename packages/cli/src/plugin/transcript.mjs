// What the plugin reads from the session (PLG-01). The claim comes from the Stop input's last_assistant_message, never
// from the transcript, whose writes may lag the turn (docs/plugin-hooks.md). The transcript gives only the order of
// tool calls: file edits, and shell commands that ran tests.
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
// A shell command runs tests when one of its segments (split at ;, &&, || and |) starts, after any VAR=value words and
// npx, bunx, pnpm exec or yarn, with a version 1 runner, a package manager's test script, or truedone --run.
const RUNNER = /^(vitest|jest|mocha|pytest|py\.test)(\s|$)|^(node|tsx)\s(.*\s)?--test(\s|=|$)|^python3?\s+-m\s+(pytest|unittest)(\s|$)|^(npm|pnpm|yarn|bun)\s+(run\s+)?test(\s|$|:)|^truedone\s(.*\s)?--run(\s|$)/;
export function isTestCommand(command) {
  return String(command).split(/;|&&|\|\||\|/).some((seg) => {
    let s = seg.trim().replace(/^\(+/, '');
    while (/^[A-Za-z_][A-Za-z0-9_]*=\S*\s+/.test(s)) s = s.replace(/^[A-Za-z_][A-Za-z0-9_]*=\S*\s+/, '');
    s = s.replace(/^(npx(\s+--?\S+)*|bunx|pnpm\s+exec|yarn(?=\s+(vitest|jest|mocha)))\s+/, '');
    return RUNNER.test(s);
  });
}
// "the tests pass" in its usual forms; a sentence saying they fail or were not run is not a claim
const CLAIM = /\b(all\s+(the\s+)?)?(\d+\s+)?(unit\s+|changed\s+|new\s+)?tests?\s+(now\s+|all\s+)?(pass(es|ed|ing)?|are\s+(passing|green)|succeed(ed)?|green)\b|\btest suite (passes|is green)\b|\bpassing tests\b/i;
const NOT = /\b(not|n't|never|no longer|fail(s|ed|ing)?)\b[^.]{0,40}\b(pass|green)|\b(pass|green)[^.]{0,20}\b(not|n't)\b/i;

export function claimsTestsPass(message) {
  if (typeof message !== 'string' || !message) return false;
  return message.split(/(?<=[.!?\n])\s+/).some((s) => CLAIM.test(s) && !NOT.test(s));
}

// Tool calls in transcript order: [{ kind: 'edit' | 'test' | 'other', name, file?, command? }]
export function toolCalls(jsonl) {
  const out = [];
  for (const line of String(jsonl).split('\n')) {
    if (!line.trim()) continue;
    let row;
    try { row = JSON.parse(line); } catch { continue; }
    const content = row?.message?.role === 'assistant' || row?.type === 'assistant' ? row?.message?.content : null;
    if (!Array.isArray(content)) continue;
    for (const c of content) {
      if (c?.type !== 'tool_use') continue;
      if (EDIT_TOOLS.has(c.name)) out.push({ kind: 'edit', name: c.name, file: c.input?.file_path ?? c.input?.notebook_path });
      else if (c.name === 'Bash' && typeof c.input?.command === 'string') out.push({ kind: isTestCommand(c.input.command) ? 'test' : 'other', name: 'Bash', command: c.input.command });
      else out.push({ kind: 'other', name: c.name });
    }
  }
  return out;
}

// true when a test command ran after the last file edit, false when none did, and null when there was no edit at all
export function ranTestsAfterLastEdit(calls) {
  let lastEdit = -1;
  calls.forEach((c, i) => { if (c.kind === 'edit') lastEdit = i; });
  if (lastEdit < 0) return null;
  return calls.slice(lastEdit + 1).some((c) => c.kind === 'test');
}

// true when the transcript's last assistant text is the Stop input's last_assistant_message: the transcript is then
// current, and its tool-call order can be trusted (docs/plugin-hooks.md, Probe)
export function holdsFinalMessage(jsonl, message) {
  if (typeof message !== 'string' || !message.trim()) return false;
  let last = null;
  for (const line of String(jsonl).split('\n')) {
    if (!line.trim()) continue;
    let row;
    try { row = JSON.parse(line); } catch { continue; }
    if (row?.type !== 'assistant' || !Array.isArray(row?.message?.content)) continue;
    const text = row.message.content.filter((c) => c?.type === 'text').map((c) => c.text).join('');
    if (text) last = text;
  }
  return last !== null && last.trim() === message.trim();
}
