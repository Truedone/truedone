// PLG-11 (PV-L01, PV-L02, PV-L04): the bundler writes no long line. The plugin directory's scanner could not read a
// 349-character line of packages/cli/plugin/hooks/stop.mjs, the brace list a bundled module returns, and held the
// plugin for it. tools/bundle.mjs now writes each module's export list one name per line. This test reads every bundle
// docs/DEPENDENCY-MAP.md's bundles node names, so a bundle added there is held too, and holds two rules: no bundle
// holds an export list on one line, and no line the bundler writes is over 200 characters. Lines that come from the
// sources stay as their authors wrote them, so a longer line passes only when it is a source file's line, less the
// indentation and comments the bundler drops.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '../..');
const LIMIT = 200;
const map = fs.readFileSync(path.join(root, 'docs/DEPENDENCY-MAP.md'), 'utf8');
const BUNDLES = JSON.parse(/```json depmap\n([\s\S]*?)```/.exec(map)[1]).nodes.bundles.paths;

// a name in an export list: an identifier, or alias: local for export { local as alias }
const NAME = String.raw`[A-Za-z_$][\w$]*(?:: [A-Za-z_$][\w$]*)?`;
// the line that opens a module's function scope: __bundle_<file> in core.mjs, __m<n> in an entry bundle
const OPEN = /^const (?:__bundle_[A-Za-z0-9_]+|__m\d+)=\(\(\)=>\{$/;
// the scope's end, its export list on one line: return {a,b,c}; then })();
const ONE_LINE = new RegExp(String.raw`^return \{(?:${NAME}(?:,${NAME})*)?\};\n\}\)\(\);$`, 'gm');
// the scope's end, its export list one name per line
const PER_LINE = new RegExp(String.raw`^return \{\n(?:(?:${NAME},\n)*${NAME}\n)?\};\n\}\)\(\);$`, 'gm');
// the lines tools/bundle.mjs writes itself, beside the lines it takes from the sources
const WRITTEN = [
  OPEN,
  /^\}\)\(\);$/,
  new RegExp(String.raw`^return \{(?:${NAME}(?:,${NAME})*)?\};$`),
  /^return \{$/,
  new RegExp(String.raw`^${NAME},?$`),
  /^\};$/,
  /^(?:export )?function ([A-Za-z_$][\w$]*)\(\.\.\.a\)\{return __bundle_[A-Za-z0-9_]+\.\1\(\.\.\.a\)\}$/,
  /^(?:export )?const ([A-Za-z_$][\w$]*)=__bundle_[A-Za-z0-9_]+\.\1;$/,
  /^const \{ .* \} = __m\d+;$/,
  /^import .* from 'node:[a-z_/]+';$/,
];

// the source lines: every .mjs file under packages/ but the bundles and the tests; the bundler reads its sources there
function sourceLines(dir = path.join(root, 'packages'), out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== 'test' && e.name !== 'node_modules') sourceLines(p, out);
    } else if (e.name.endsWith('.mjs') && !BUNDLES.includes(path.relative(root, p).split(path.sep).join('/'))) {
      for (const l of fs.readFileSync(p, 'utf8').split('\n')) if (l.trim()) out.push(l.trimStart());
    }
  }
  return out;
}
const SOURCES = sourceLines();
const lineOf = (text, index) => text.slice(0, index).split('\n').length;

test('the dependency map names the bundles, and each is a file', () => {
  assert.ok(BUNDLES.length >= 5, `bundles: ${BUNDLES.join(', ')}`);
  for (const f of BUNDLES) assert.ok(fs.statSync(path.join(root, f)).isFile(), f);
  assert.ok(SOURCES.length > 1000, `${SOURCES.length} source lines`);
});

for (const f of BUNDLES) {
  test(`${f}: no export list is on one line, each is one name per line`, () => {
    const text = fs.readFileSync(path.join(root, f), 'utf8');
    const opens = text.split('\n').filter((l) => OPEN.test(l)).length;
    assert.ok(opens >= 1, `${f} opens no module scope`);
    const oneLine = [...text.matchAll(ONE_LINE)].map((m) => `${f}:${lineOf(text, m.index)} (${m[0].indexOf('\n')})`);
    assert.deepEqual(oneLine, [], 'export lists on one line');
    const perLine = [...text.matchAll(PER_LINE)].length;
    assert.ok(perLine >= opens, `${opens} module scopes, ${perLine} export lists one name per line`);
  });

  test(`${f}: no line the bundler writes is over ${LIMIT} characters`, () => {
    const lines = fs.readFileSync(path.join(root, f), 'utf8').split('\n');
    const long = lines.flatMap((l, i) => {
      if (l.length <= LIMIT) return [];
      const at = `${f}:${i + 1} (${l.length})`;
      if (WRITTEN.some((r) => r.test(l))) return [`${at} the bundler wrote it`];
      const t = l.trimStart();
      return SOURCES.some((s) => s.startsWith(t)) ? [] : [`${at} is no source file's line`];
    });
    assert.deepEqual(long, [], `lines over ${LIMIT} characters`);
  });
}
