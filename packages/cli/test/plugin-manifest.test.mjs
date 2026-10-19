// PLG-02-AC01: the marketplace and plugin manifests have the shape the plugins reference documents
// (https://code.claude.com/docs/en/plugin-marketplaces, https://code.claude.com/docs/en/plugins-reference): a root
// .claude-plugin/marketplace.json with name, owner.name and a plugin whose relative source holds
// .claude-plugin/plugin.json of the same name, and a hooks/hooks.json that wraps its events in "hooks" and runs the
// one Stop hook as node "${CLAUDE_PLUGIN_ROOT}/hooks/stop.mjs".
// PLG-04-AC01: the plugin's homepage is the site (D26) and the marketplace's owner is the Truedone organisation (D36).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const read = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));
const market = read('.claude-plugin/marketplace.json');
const entry = market.plugins?.[0];
const dir = entry && path.join(ROOT, entry.source);

test('the marketplace is named truedone, has an owner name, and lists exactly one plugin, truedone', () => {
  assert.equal(market.name, 'truedone');
  assert.equal(typeof market.owner?.name, 'string');
  assert.ok(market.owner.name.length > 0);
  assert.equal(market.plugins.length, 1);
  assert.equal(entry.name, 'truedone');
});

test('the plugin source is a relative path inside the repository, holding .claude-plugin/plugin.json of the same name', () => {
  assert.match(entry.source, /^\.\/[^.]/);
  assert.ok(path.resolve(dir).startsWith(path.resolve(ROOT)), 'inside the repository');
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, '.claude-plugin/plugin.json'), 'utf8'));
  assert.equal(manifest.name, 'truedone');
  assert.match(manifest.name, /^[a-z0-9]+(-[a-z0-9]+)*$/, 'kebab-case');
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
});

test('hooks/hooks.json wraps the events in "hooks" and declares one Stop command hook run by node from the plugin root', () => {
  const h = JSON.parse(fs.readFileSync(path.join(dir, 'hooks/hooks.json'), 'utf8'));
  assert.deepEqual(Object.keys(h), ['hooks']);
  assert.deepEqual(Object.keys(h.hooks), ['Stop']);
  const hooks = h.hooks.Stop.flatMap((m) => m.hooks);
  assert.equal(hooks.length, 1);
  assert.equal(hooks[0].type, 'command');
  assert.equal(hooks[0].command, 'node "${CLAUDE_PLUGIN_ROOT}/hooks/stop.mjs"');
});

test('the plugin directory holds only its manifest, its hooks file and the one hook script', () => {
  const files = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else files.push(path.relative(dir, f)); } };
  walk(dir);
  assert.deepEqual(files.sort().filter((f) => f !== 'hooks/stop.mjs'), ['.claude-plugin/plugin.json', 'hooks/hooks.json']);
});

// PLG-04: the plugin's manifest named https://truedone.dev, a domain that does not exist, and the marketplace's owner was
// mgillr. The homepage is the site, https://truedone.pages.dev (D26), and the owner is the Truedone organisation (D36);
// the manifest's author stays the person, mgillr.
test("the plugin's homepage is the site, https://truedone.pages.dev, and the manifest names no truedone.dev", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, '.claude-plugin/plugin.json'), 'utf8'));
  assert.equal(manifest.homepage, 'https://truedone.pages.dev');
  assert.doesNotMatch(JSON.stringify(manifest), /truedone\.dev/);
});

test('the marketplace is owned by the Truedone organisation', () => {
  assert.deepEqual(market.owner, { name: 'Truedone', url: 'https://github.com/Truedone' });
});
