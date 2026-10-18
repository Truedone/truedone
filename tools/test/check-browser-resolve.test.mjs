// REPO-03-AC01: the browser resolver prefers CHROMIUM_BIN, falls back to the
// PATH names and then the standard macOS and Linux install paths, and names
// every place it looked when nothing is found. The candidate list and the
// PATH lookup are parameters, so this test drives the resolver without a
// browser. Red on main: the tool exports no resolver and runs its check at
// import time.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveBrowser } from '../check-browser.mjs';

const PATH_NAMES = ['chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable'];
const FILE_PATHS = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
];

function drive({ env = {}, onPath = {}, onDisk = {} }) {
  return resolveBrowser({
    env,
    lookup: (name) => onPath[name] ?? null,
    exists: (p) => onDisk[p] === true,
  });
}

test('a standard macOS Chrome install is found when CHROMIUM_BIN is unset and nothing is on PATH', () => {
  const bin = drive({ onDisk: { '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome': true } });
  assert.equal(bin, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
});

test('CHROMIUM_BIN wins over everything', () => {
  const bin = drive({
    env: { CHROMIUM_BIN: '/custom/browser' },
    onPath: { chromium: '/usr/local/bin/chromium' },
    onDisk: { '/custom/browser': true, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome': true },
  });
  assert.equal(bin, '/custom/browser');
});

test('a PATH hit is used before the standard paths', () => {
  const bin = drive({
    onPath: { 'google-chrome': '/usr/local/bin/google-chrome' },
    onDisk: { '/usr/bin/google-chrome': true },
  });
  assert.equal(bin, '/usr/local/bin/google-chrome');
});

test('a standard Linux path is found', () => {
  const bin = drive({ onDisk: { '/usr/bin/chromium': true } });
  assert.equal(bin, '/usr/bin/chromium');
});

test('when nothing is found the error names every place it looked', () => {
  assert.throws(() => drive({}), (e) => {
    const places = ['CHROMIUM_BIN', ...PATH_NAMES, ...FILE_PATHS];
    return places.every((p) => e.message.includes(p)) && e.message.length > 0;
  });
});

test('a CHROMIUM_BIN that is not a file is an error, not a fallthrough', () => {
  assert.throws(
    () => drive({ env: { CHROMIUM_BIN: '/gone' } }),
    (e) => e.message.includes('/gone') && e.message.includes('CHROMIUM_BIN'),
  );
});

test('the tool is importable without running its check', () => {
  assert.equal(typeof resolveBrowser, 'function');
});
