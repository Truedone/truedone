// PLG-09-AC01: Anthropic's plugin directory builds the listing from plugin.json and the README, and found no display name,
// keywords, privacy policy, documentation or terms link, and took support from the README's wrong-verdict form. The
// manifest now names each one, and every other key keeps its value; the README links the privacy policy and the terms, and
// its support section names the issues page beside the wrong-verdict form. This test reads files only: whether each link
// answers 200 is PLG-09-AC02's, the criterion that fetches them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const text = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const manifest = JSON.parse(text('packages/cli/plugin/.claude-plugin/plugin.json'));
const readme = text('packages/cli/plugin/README.md');
const section = (heading) => { const i = readme.indexOf(`\n## ${heading}\n`); assert.ok(i >= 0, `the README has no "## ${heading}" section`); const j = readme.indexOf('\n## ', i + 4); return readme.slice(i, j < 0 ? undefined : j); };

test('the manifest names the listing: display name, keywords, and the support, documentation, privacy and terms links', () => {
  assert.equal(manifest.displayName, 'truedone');
  assert.deepEqual(manifest.keywords, ['testing', 'tests', 'pull-requests', 'code-review', 'tdd', 'red-green', 'hooks']);
  assert.equal(manifest.supportUrl, 'https://github.com/Truedone/truedone/issues');
  assert.equal(manifest.documentationUrl, 'https://github.com/Truedone/truedone/blob/main/packages/cli/plugin/README.md');
  assert.equal(manifest.privacyPolicyUrl, 'https://truedone.pages.dev/privacy');
  assert.equal(manifest.termsOfServiceUrl, 'https://truedone.pages.dev/terms');
});

test('every other key keeps its value, and nothing else is added', () => {
  const version = JSON.parse(text('packages/cli/package.json')).version;
  assert.deepEqual(manifest, {
    name: 'truedone',
    displayName: 'truedone',
    version,
    description: 'One Stop hook: blocks when a changed test fails, a test was weakened, or the agent says tests pass without running them',
    author: { name: 'mgillr', url: 'https://github.com/mgillr' },
    license: 'Apache-2.0',
    homepage: 'https://truedone.pages.dev',
    repository: 'https://github.com/Truedone/truedone',
    keywords: manifest.keywords,
    supportUrl: manifest.supportUrl,
    documentationUrl: manifest.documentationUrl,
    privacyPolicyUrl: manifest.privacyPolicyUrl,
    termsOfServiceUrl: manifest.termsOfServiceUrl,
  });
});

test('the documentation link is this README on main', () => {
  assert.equal(manifest.documentationUrl, `${manifest.repository}/blob/main/packages/cli/plugin/README.md`);
  assert.ok(fs.existsSync(path.join(ROOT, 'packages/cli/plugin/README.md')));
});

test("the README's Privacy and terms section links the manifest's two pages", () => {
  const s = section('Privacy and terms');
  assert.ok(s.includes(manifest.privacyPolicyUrl), 'the privacy policy');
  assert.ok(s.includes(manifest.termsOfServiceUrl), 'the terms');
});

test("the README's support section names the issues page beside the wrong-verdict form", () => {
  const s = section('Support');
  assert.ok(s.includes(`${manifest.supportUrl}.`) || s.includes(`${manifest.supportUrl} `) || s.includes(`${manifest.supportUrl}\n`), 'the issues page');
  assert.ok(s.includes(`${manifest.supportUrl}/new?template=wrong-verdict.yml`), 'the wrong-verdict form');
});
