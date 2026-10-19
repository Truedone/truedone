// CLI-05-AC01: the MCP registry entry and the npm package it lists say the same thing. The registry lists an npm server
// only when the published package.json's mcpName equals server.json's name, so server.json's name is held to mcpName, its
// version and its one package's version to package.json's, and that package is npm truedone over stdio with the argument
// mcp, the command a client runs: npx truedone mcp. The published file is then started with those arguments and must
// answer the protocol's initialize as truedone at that version.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = new URL('../../../', import.meta.url);
const read = (p) => {
  const file = fileURLToPath(new URL(p, ROOT));
  assert.ok(fs.existsSync(file), `${p} exists`);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
};

test("server.json's name is package.json's mcpName, under the Truedone organisation's namespace", () => {
  const pkg = read('packages/cli/package.json');
  const server = read('server.json');
  assert.equal(pkg.mcpName, 'io.github.Truedone/truedone');
  assert.equal(server.name, pkg.mcpName);
  assert.match(server.$schema, /^https:\/\/static\.modelcontextprotocol\.io\/schemas\/\d{4}-\d{2}-\d{2}\/server\.schema\.json$/);
  assert.ok(server.description.length >= 1 && server.description.length <= 100, `description is ${server.description.length} characters; the schema allows 1 to 100`);
  assert.deepEqual(server.repository, { url: 'https://github.com/Truedone/truedone', source: 'github' });
});

test("server.json's version and its package's version are package.json's", () => {
  const pkg = read('packages/cli/package.json');
  const server = read('server.json');
  assert.equal(server.version, pkg.version);
  assert.equal(server.packages?.length, 1, 'one package');
  assert.equal(server.packages[0].version, pkg.version);
});

test('the one package is npm truedone over stdio with the argument mcp', () => {
  const pkg = read('packages/cli/package.json');
  const [entry] = read('server.json').packages;
  assert.equal(entry.registryType, 'npm');
  assert.equal(entry.identifier, 'truedone');
  assert.equal(entry.identifier, pkg.name);
  assert.deepEqual(entry.transport, { type: 'stdio' });
  assert.deepEqual(entry.packageArguments, [{ type: 'positional', value: 'mcp' }]);
});

test('the published file, started with the package arguments, answers initialize as truedone at the package version', () => {
  const pkg = read('packages/cli/package.json');
  const [entry] = read('server.json').packages;
  const bin = fileURLToPath(new URL(`packages/cli/${pkg.bin.truedone}`, ROOT));
  const hello = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'registry-test', version: '0' } } };
  const r = spawnSync(process.execPath, [bin, ...entry.packageArguments.map((a) => a.value)], { input: `${JSON.stringify(hello)}\n`, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const answers = r.stdout.split('\n').filter(Boolean).map((l) => JSON.parse(l));
  assert.equal(answers.length, 1, r.stdout);
  assert.equal(answers[0].id, 1);
  assert.deepEqual(answers[0].result.serverInfo, { name: 'truedone', version: pkg.version });
});
