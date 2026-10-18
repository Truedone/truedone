// WEB-09-AC02 (#83, #84; WCAG 1.4.11 and 1.4.3), computed from style.css with no browser: the colour of the field's
// border and of its placeholder, each a var() in its rule, resolved through the tokens of :root and of the dark-scheme
// block, against the field's own background, which is --bg. The border is the field's only boundary, so it needs 3:1;
// the placeholder is text, so it needs 4.5:1; in both themes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const css = fs.readFileSync(new URL('../style.css', import.meta.url), 'utf8');
const tokens = (block) => Object.fromEntries([...block.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})\b/g)].map((m) => [m[1], m[2].toLowerCase()]));
const light = tokens(css.match(/^:root\s*\{([\s\S]*?)^\}/m)[1]);
const dark = { ...light, ...tokens(css.match(/@media \(prefers-color-scheme: dark\)\s*\{\s*:root\s*\{([\s\S]*?)\}/)[1]) };
const rule = (selector) => css.match(new RegExp(`(?:^|\\n)${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`))?.[1] ?? null;
const varOf = (body, property) => body?.match(new RegExp(`(?:^|[;{\\s])${property}\\s*:[^;]*var\\(--([\\w-]+)\\)`))?.[1] ?? null;

// WCAG 2 relative luminance and contrast ratio
const lum = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

test('the tokens are read from the stylesheet: --bg is #ffffff in light and #0d1117 in dark', () => {
  assert.equal(light.bg, '#ffffff');
  assert.equal(dark.bg, '#0d1117');
  assert.ok(Math.abs(ratio('#d1d9e0', '#ffffff') - 1.43) < 0.01, 'the ratio function gives the measured 1.43 for the old border');
});

test('the field\'s border is 3:1 or more against its background, in light and dark', () => {
  const field = rule('#go input');
  assert.ok(field, 'the #go input rule');
  const border = varOf(field, 'border') ?? varOf(field, 'border-color');
  const bg = varOf(field, 'background') ?? varOf(field, 'background-color');
  assert.equal(bg, 'bg', 'the field\'s own background is --bg');
  for (const [theme, t] of [['light', light], ['dark', dark]]) {
    const r = ratio(t[border], t[bg]);
    assert.ok(r >= 3, `${theme}: --${border} ${t[border]} on ${t[bg]} is ${r.toFixed(2)}:1`);
  }
});

test('the field\'s placeholder is 4.5:1 or more against its background, in light and dark, at full opacity', () => {
  const ph = rule('#go input::placeholder');
  assert.ok(ph, 'a #go input::placeholder rule');
  const color = varOf(ph, 'color');
  assert.ok(color, 'its colour is a token');
  assert.match(ph, /opacity:\s*1\b/, 'opacity 1, since some browsers dim the placeholder by default');
  for (const [theme, t] of [['light', light], ['dark', dark]]) {
    const r = ratio(t[color], t.bg);
    assert.ok(r >= 4.5, `${theme}: --${color} ${t[color]} on ${t.bg} is ${r.toFixed(2)}:1`);
  }
});
