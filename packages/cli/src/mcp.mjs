// npx truedone mcp (MCP-01, D38): the check as a tool for any agent that speaks the Model Context Protocol. JSON-RPC 2.0, one
// message per line on stdin and stdout, from the same single file with no dependency. Two tools: truedone_check_pr {url} and
// truedone_check_branch {path?}. A call answers with the --pr-line line as text and core's truedone.verdict/1 result as
// structured content. Nothing but protocol messages goes to stdout; a notification gets no answer; an unknown method answers
// -32601. The server ends when stdin ends, or when the client closes stdout.
import readline from 'node:readline';
import { VERSION } from './constants.mjs';
import { parseTarget } from './target.mjs';
import { prLine } from './output.mjs';

export const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];

export const TOOLS = [
  {
    name: 'truedone_check_pr',
    title: 'Check a pull request with truedone',
    description: 'Whether a pull request\'s tests prove its change: tests disabled, focused or weakened, and source changed with no test, read statically from GitHub. Returns the verdict line for a pull request description and the truedone.verdict/1 result.',
    inputSchema: { type: 'object', properties: { url: { type: 'string', description: 'A pull request link on github.com or truedone.pages.dev, or owner/repo#n' } }, required: ['url'], additionalProperties: false },
  },
  {
    name: 'truedone_check_branch',
    title: 'Check the current branch with truedone',
    description: 'The same check on a local branch and working tree, against the merge-base with the default branch. Run it before reporting a task done; put the returned line in the pull request description.',
    inputSchema: { type: 'object', properties: { path: { type: 'string', description: 'The repository directory; the server\'s working directory when omitted' } }, additionalProperties: false },
  },
];

const ok = (id, result) => ({ jsonrpc: '2.0', id, result });
const err = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });

// check(args) runs one tool: { target } or { dir } in, { result } out; Refused and other errors become a tool error result
export async function serveMcp({ stdin, stdout, cwd, check }) {
  const lines = readline.createInterface({ input: stdin, crlfDelay: Infinity });
  // a client that closes its end of stdout (EPIPE) ends the session: later answers are dropped, not thrown
  let gone = false;
  stdout.on?.('error', () => { gone = true; lines.close(); });
  const send = (m) => { if (!gone) stdout.write(`${JSON.stringify(m)}\n`); };
  async function handle(msg) {
    const hasId = Object.hasOwn(msg, 'id') && msg.id !== null;
    if (typeof msg.method !== 'string') { if (hasId) send(err(msg.id, -32600, 'Invalid request')); return; }
    if (!hasId) return;   // notifications, initialized and cancelled included, get no answer
    const p = msg.params ?? {};
    switch (msg.method) {
      case 'initialize':
        return send(ok(msg.id, {
          protocolVersion: PROTOCOL_VERSIONS.includes(p.protocolVersion) ? p.protocolVersion : PROTOCOL_VERSIONS[0],
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'truedone', version: VERSION },
          // no tool is named here: the tool names come from tools/list alone
          instructions: 'Before reporting a task done, run the branch check, and put the line it returns in the pull request description.',
        }));
      case 'ping':
        return send(ok(msg.id, {}));
      case 'tools/list':
        return send(ok(msg.id, { tools: TOOLS }));
      case 'tools/call': {
        const args = p.arguments ?? {};
        let target = null, dir = null;
        if (p.name === 'truedone_check_pr') {
          target = typeof args.url === 'string' ? parseTarget(args.url) : null;
          if (!target) return send(ok(msg.id, { content: [{ type: 'text', text: 'truedone: url is not a pull request link or owner/repo#n' }], isError: true }));
        } else if (p.name === 'truedone_check_branch') {
          dir = typeof args.path === 'string' && args.path ? args.path : cwd;
        } else return send(err(msg.id, -32602, `unknown tool ${p.name}`));
        try {
          const { result } = await check({ target, dir });
          return send(ok(msg.id, { content: [{ type: 'text', text: prLine(result, target) }], structuredContent: result, isError: false }));
        } catch (e) {
          return send(ok(msg.id, { content: [{ type: 'text', text: `truedone: ${String(e?.message ?? e).split('\n')[0]}` }], isError: true }));
        }
      }
      default:
        return send(err(msg.id, -32601, `Method not found: ${msg.method}`));
    }
  }
  for await (const line of lines) {
    if (!line.trim()) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { send(err(null, -32700, 'Parse error')); continue; }
    if (Array.isArray(msg) || typeof msg !== 'object' || msg === null) { send(err(null, -32600, 'Invalid request')); continue; }
    await handle(msg);
  }
  return 0;
}
