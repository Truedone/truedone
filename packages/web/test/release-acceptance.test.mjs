// REL-P4-AC01 (D35): a surface is released only after a walk of its install path from a fresh home works. Every surface
// set true in lib/release.mjs has a row in the "## Acceptance" table of docs/releases/preview-0.1.0.md, "| <surface> |
// <command> | <output> | <UTC time> | Works |", whose output names the build it ran ("Build: ...", the CLI by npm's
// dist.integrity, the App by the production Worker's /health version, the plugin by its installed commit) and its
// evidence ("Evidence: ..."). The App row names app slug truedone, never truedone-dev, and the label event's actor
// truedone[bot]. A surface set true without such a row fails, and so does each part of a row taken away.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { RELEASED } from '../lib/release.mjs';
import { EXAMPLES } from '../lib/view.mjs';

const NOTES = fs.readFileSync(new URL('../../../docs/releases/preview-0.1.0.md', import.meta.url), 'utf8');
// each surface's row by its Surface cell
const ROW = { site: 'The site', cli: 'The command line', app: 'The GitHub App', plugin: 'The plugin', action: 'The action' };
const HEX40 = /^[0-9a-f]{40}$/;
// the build each surface's row names, after "Build: "
const BUILD = {
  cli: /\bdist\.integrity (sha512-[A-Za-z0-9+/]{86}==)/,
  app: /\/health version ([0-9a-f]{40})\b/,
  plugin: /\binstalled commit ([0-9a-f]{40})\b/,
};

// the table's rows under "## Acceptance": { surface, command, output, time, result }
export function rows(notes) {
  const at = notes.search(/^## Acceptance$/m);
  if (at < 0) return null;
  const body = notes.slice(at).split('\n').slice(1);
  const end = body.findIndex((l) => /^## /.test(l));
  const table = (end < 0 ? body : body.slice(0, end)).filter((l) => l.startsWith('| '));
  return table.slice(2).map((l) => {
    const c = l.slice(2, -2).split(' | ');
    return c.length === 5 ? { surface: c[0], command: c[1], output: c[2], time: c[3], result: c[4] } : { bad: l };
  });
}

// the integrity of the tarball the command line's section of the notes measured (REL-P1)
const packed = (notes) => notes.match(/^tarball truedone-[\d.]+\.tgz, \d+ bytes, integrity (sha512-\S+)$/m)?.[1] ?? null;

// what is wrong for each surface set true; empty when every one has its Works row
export function problems(notes, released) {
  const all = rows(notes);
  if (!all) return Object.keys(released).filter((s) => released[s]).map((s) => `${s}: the notes have no "## Acceptance" table`);
  const out = all.filter((r) => r.bad).map((r) => `a row without five cells: ${r.bad.slice(0, 60)}`);
  for (const s of Object.keys(released).filter((k) => released[k])) {
    const mine = all.filter((r) => r.surface === ROW[s]);
    if (mine.length !== 1) { out.push(`${s}: ${mine.length} rows named "${ROW[s]}", not one`); continue; }
    const [r] = mine;
    if (r.result !== 'Works') { out.push(`${s}: the row says "${r.result}", not Works`); continue; }
    if (!r.command.trim()) out.push(`${s}: the row names no command`);
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(r.time)) out.push(`${s}: "${r.time}" is not a UTC time`);
    const build = r.output.match(/\bBuild: (.+?)(?= Evidence: |$)/)?.[1] ?? '';
    const named = BUILD[s] ? build.match(BUILD[s])?.[1] : build.trim();
    if (!named) out.push(`${s}: the row names no build`);
    if (s === 'cli' && named && named !== packed(notes)) out.push(`cli: the build ${named} is not the integrity of the tarball the notes measured`);
    if ((s === 'app' || s === 'plugin') && named && !HEX40.test(named)) out.push(`${s}: the build is not a commit`);
    if (!/\bEvidence: \S/.test(r.output)) out.push(`${s}: the row names no evidence`);
    if (s === 'app') {
      if (!/\bcheck run \d+ of app slug truedone(?![\w-])/.test(r.output)) out.push('app: the row names no check run id of app slug truedone');
      if (!/\bactor truedone\[bot\](?![\w-])/.test(r.output)) out.push('app: the row names no label event by actor truedone[bot]');
    }
  }
  return out;
}

const examples = EXAMPLES.map(([verdict, href]) => [href.slice(1).replace('/pull/', '#'), verdict]);
const one = (s) => ({ cli: false, action: false, app: false, plugin: false, [s]: true });
const row = (s) => {
  const r = (rows(NOTES) ?? []).find((x) => x.surface === ROW[s]);
  assert.ok(r, `the acceptance table has a row "${ROW[s]}"`);
  return r;
};
const swap = (s, from, to) => {
  const line = NOTES.split('\n').find((l) => l.startsWith(`| ${ROW[s]} | `));
  assert.ok(line && line.includes(from), `the ${s} row holds "${from}"`);
  return NOTES.replace(line, line.replace(from, to));
};

test('every surface set true in release.mjs has a Works row that names its build and its evidence', () => {
  assert.match(NOTES, /^## Acceptance$/m);
  assert.deepEqual(problems(NOTES, RELEASED), []);
});

test('the App row names app slug truedone and actor truedone[bot]', () => {
  assert.equal(RELEASED.app, true);
  const r = row('app');
  assert.equal(r.result, 'Works');
  assert.match(r.output, /\bcheck run \d+ of app slug truedone(?![\w-])/);
  assert.match(r.output, /\bactor truedone\[bot\](?![\w-])/);
});

test('the site and command line rows read the five examples, each with the verdict the notes give', () => {
  const notes = [...NOTES.matchAll(/^\$ truedone https:\/\/github\.com\/(\S+)\/pull\/(\d+) --json {3}-> (\S+)$/gm)].map((m) => [`${m[1]}#${m[2]}`, m[3]]);
  assert.deepEqual(notes, examples, "the command line section's five are the site's five");
  for (const s of ['site', 'cli']) {
    const evidence = row(s).output.split('Evidence: ')[1] ?? '';
    for (const [target, verdict] of examples) assert.ok(evidence.includes(`${target} ${verdict}`), `${s}: ${target} ${verdict}`);
  }
});

for (const s of ['cli', 'app', 'plugin', 'action']) {
  test(`${s} set true: it passes only with its Works row whole, and each part taken away fails`, () => {
    const r = row(s);
    assert.ok(r, `a row for ${s}`);
    if (r.result !== 'Works') {
      assert.equal(RELEASED[s], false, `${s} has no Works row, so it stays false`);
      assert.match(problems(NOTES, one(s)).join('\n'), new RegExp(`^${s}: the row says`));
      return;
    }
    assert.deepEqual(problems(NOTES, one(s)), [], `${s}: the committed row passes`);
    const line = NOTES.split('\n').find((l) => l.startsWith(`| ${ROW[s]} | `));
    const fails = (notes, why) => assert.notDeepEqual(problems(notes, one(s)), [], why);
    fails(NOTES.replace(`${line}\n`, ''), 'no row');
    fails(swap(s, '| Works |', '| Failed |'), 'a row that does not say Works');
    fails(swap(s, 'Build: ', 'Ran: '), 'no build');
    fails(swap(s, 'Evidence: ', 'Seen: '), 'no evidence');
    fails(NOTES.replace(/^## Acceptance$/m, '## Walked'), 'no Acceptance table');
    if (s === 'cli') fails(NOTES.replace(line, line.replace(r.output.match(BUILD.cli)[1], `sha512-${'A'.repeat(86)}==`)), 'an integrity that is not the measured tarball');
    if (s === 'app' || s === 'plugin') fails(NOTES.replace(line, line.replace(r.output.match(BUILD[s])[1], 'main')), 'a build that is not a commit');
    if (s === 'app') {
      fails(swap(s, 'app slug truedone ', 'app slug truedone-dev '), 'the development App');
      fails(swap(s, 'actor truedone[bot]', 'actor truedone-dev[bot]'), 'the development App as the actor');
      fails(swap(s, 'check run ', 'run '), 'no check run id');
    }
  });
}
