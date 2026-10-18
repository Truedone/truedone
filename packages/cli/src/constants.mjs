// The static limits and the file classes whose base and head contents are read. Both the PR reader (github.mjs) and
// the local diff reader (local.mjs) use them, and this file holds no network code, so the plugin hook, which bundles
// the local reader, carries none either.
export const LIMITS = { files: 300, lines: 20000, fetched: 100 };   // docs/spec.md, Limits (static)
export const CONTENT = new Set(['test', 'setup', 'runner_config', 'workflow', 'truedone_config']);   // core's class names
// The version npx truedone reports (D39's wrong-verdict form, and the MCP server's name and version); it is the
// version in packages/cli/package.json, which test/agent-spread.test.mjs holds it to.
export const VERSION = '0.1.0';
