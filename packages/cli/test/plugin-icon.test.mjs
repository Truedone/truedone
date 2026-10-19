// PLG-07-AC01: Anthropic's plugin directory takes a plugin's listing icon from .claude-plugin/icon.png in the plugin
// folder, only the first time the plugin is saved or submitted: a square PNG, 512 to 2048 px on each side, under 2 MB.
// The icon is a byte copy of the App's 512 x 512 logo, packages/app/logo.png, so the plugin, the App and the site show
// one mark. The size comes from the PNG's own IHDR chunk, the first after the signature.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const ICON = path.join(ROOT, 'packages/cli/plugin/.claude-plugin/icon.png');
const LOGO = path.join(ROOT, 'packages/app/logo.png');
const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function png(file) {
  const b = fs.readFileSync(file);
  assert.ok(b.subarray(0, 8).equals(SIGNATURE), `${file} is not a PNG`);
  assert.equal(b.toString('latin1', 12, 16), 'IHDR', `${file} does not start with its IHDR chunk`);
  return { bytes: b, width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}

test('the icon is a square PNG of 512 to 2048 px on each side, under 2 MB', () => {
  assert.ok(fs.existsSync(ICON), `${ICON} is missing`);
  const { bytes, width, height } = png(ICON);
  assert.equal(width, height, `${width} x ${height} is not square`);
  assert.ok(width >= 512 && width <= 2048, `${width} px is outside 512 to 2048`);
  assert.ok(bytes.length < 2 * 1000 * 1000, `${bytes.length} bytes is not under 2 MB`);
});

test("the icon is the App's logo, byte for byte", () => {
  assert.ok(fs.existsSync(ICON), `${ICON} is missing`);
  assert.ok(png(ICON).bytes.equals(png(LOGO).bytes), 'the icon differs from packages/app/logo.png');
});
