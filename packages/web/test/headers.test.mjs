// WEB-06: the headers every page of the site is served with (_headers) say no to sniffing a type and to the camera,
// the microphone and geolocation, next to the content security policy; and robots.txt lets every crawler in and names
// /why, the page that says what truedone does.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

// the header lines of the one "/*" block, as name -> value
function headers() {
  const lines = read('_headers').split('\n');
  assert.equal(lines[0], '/*');
  const out = {};
  for (const l of lines.slice(1)) {
    const m = l.match(/^\s+([A-Za-z-]+):\s*(.+)$/);
    if (m) out[m[1].toLowerCase()] = m[2].trim();
  }
  return out;
}

test('every page is served with nosniff and a Permissions-Policy that denies the camera, the microphone and geolocation', () => {
  const h = headers();
  assert.equal(h['x-content-type-options'], 'nosniff');
  const policy = Object.fromEntries((h['permissions-policy'] ?? '').split(',').map((d) => d.trim().split('=')));
  for (const f of ['camera', 'microphone', 'geolocation']) assert.equal(policy[f], '()', f);
  assert.match(h['content-security-policy'] ?? '', /^default-src 'none';/, 'the policy is still there');
});

test('robots.txt allows every crawler and names /why', () => {
  const lines = read('robots.txt').split('\n').map((l) => l.trim()).filter(Boolean);
  assert.deepEqual(lines.filter((l) => !l.startsWith('#')), ['User-agent: *', 'Allow: /']);
  assert.ok(lines.some((l) => l.startsWith('#') && l.includes('https://truedone.pages.dev/why')), 'a line names /why');
});
