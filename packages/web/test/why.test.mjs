// WEB-04: packages/web/why.html, the page every truedone:* label description links to, lists the eight labels in the
// order of the verdicts table in docs/spec.md, each with its verdict, when it is given and what to do next in the
// table's words. It works under the site's content security policy as it is, ends with the next rung, and no rule in
// _redirects takes /why from it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const root = new URL('../../../', import.meta.url);
const read = (p) => fs.readFileSync(new URL(p, root), 'utf8');
const html = read('packages/web/why.html');
// the page as text: tags dropped, entities decoded, white space collapsed
const text = html.replace(/<[^>]*>/g, ' ').replace(/&#39;|&#x27;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
const clean = (s) => s.replace(/\*\*|`/g, '').trim();
// the table under "## From the design: verdicts": verdict, label, from the diff alone, given when, what to do next
const section = read('docs/spec.md').split(/^## From the design: verdicts$/m)[1].split(/^## /m)[0];
const rows = section.split('\n').filter((l) => l.startsWith('| **')).map((l) => l.split('|').slice(1, -1).map(clean)).map(([verdict, label, , when, next]) => ({ verdict, label, when, next }));
// the labels in the table's order, each with its verdicts
const groups = [];
for (const r of rows.filter((x) => x.label !== 'none')) {
  const g = groups.find((x) => x.label === r.label);
  if (g) g.rows.push(r); else groups.push({ label: r.label, rows: [r] });
}

test('the spec table gives ten verdicts and eight labels, Proven and Proven (new behaviour) sharing truedone:yes', () => {
  assert.equal(rows.length, 10);
  assert.deepEqual(groups.map((g) => g.label), ['truedone:tampered', 'truedone:review', 'truedone:could-not-run', 'truedone:yes', 'truedone:weak', 'truedone:no-evidence', 'truedone:pending', 'truedone:unrun']);
  assert.deepEqual(groups.find((g) => g.label === 'truedone:yes').rows.map((r) => r.verdict), ['Proven', 'Proven (new behaviour)']);
});

test('each label appears in the table order, followed by each of its verdicts, when it is given and what to do next', () => {
  let at = 0;
  for (const g of groups) {
    for (const part of [g.label, ...g.rows.flatMap((r) => [r.verdict, r.when, r.next])]) {
      const i = text.indexOf(part, at);
      assert.ok(i >= 0, `${g.label}: "${part.slice(0, 70)}" is not on the page after the part before it`);
      at = i + part.length;
    }
  }
  assert.ok(!text.includes('Not applicable sets a label'), 'Not applicable has no label');
});

test('the page has no script, no inline style and no event attribute, and links the site stylesheet', () => {
  assert.doesNotMatch(html, /<script|<style|\sstyle\s*=|\son[a-z]+\s*=|javascript:/i);
  assert.match(html, /<link rel="stylesheet" href="\/style\.css">/);
});

test('the page ends with the next rung, which says red-green on someone else\'s PR executes that PR\'s code', () => {
  const rung = text.indexOf('Next rung: red-green on your machine');
  assert.ok(rung > text.indexOf(groups.at(-1).rows.at(-1).next), 'the next rung comes after the last label');
  assert.ok(text.indexOf("executes that PR's code", rung) > rung);
  assert.ok(text.includes('npx truedone <PR link> --run'));
});

test('no rule in _redirects takes /why, so Pages serves why.html there', () => {
  for (const line of read('packages/web/_redirects').split('\n')) {
    assert.doesNotMatch(line, /^\/(why|why\/|why\.html|\*|:[A-Za-z]+)(\s|$)/, line);
  }
});
