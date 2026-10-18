// node tools/gate6.mjs <release> [--since YYYY-MM-DD] [--sources <file>] [--out <file>] (GATE-06): the gate 6
// research for one release. It reads the watch list in docs/gates/gate6-sources.md, a table with one row per source
// and the feeds the row names (RSS or Atom), and keeps the entries published since the last check: --since, else the
// "Checked:" date of the newest earlier docs/gates/gate6-*-research.md, else 90 days back. Of those it lists the
// entries whose title or summary matches red-green, fail on base, test tamper, weakened test or skipped test, with
// their links, and writes docs/gates/gate6-<release>-research.md. A source the table marks "no public changelog found"
// is listed as such; a feed that cannot be read is listed with the reason, and the run goes on; a feed whose oldest
// entry is after the cut says how far back it reaches, since a feed holds only its newest entries. Ryan reads the file
// and writes the Window line himself (REL-W*), so the script writes none. No dependencies.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const TERMS = [
  ['red-green', /\bred[\s/-]*green\b/i],
  ['fail on base', /\bfail(?:s|ed|ing)?\s+on\s+(?:the\s+)?(?:base|merge[\s-]base)\b/i],
  ['test tamper', /\btests?[\s-]+tamper(?:s|ed|ing)?\b|\btamper(?:s|ed|ing)?\s+(?:with\s+)?(?:the\s+)?tests?\b/i],
  ['weakened test', /\bweaken(?:s|ed|ing)?\s+(?:the\s+)?(?:tests?|assertions?)\b|\b(?:test|assertion)\s+weakening\b/i],
  ['skipped test', /\bskip(?:s|ped|ping)?\s+(?:the\s+)?tests?\b|\bskipped[\s-]+tests?\b/i],
];
const NONE = 'no public changelog found';
const DAY = 86400000;

// the table rows: | Source | Feeds | Note |, feeds as space- or comma-separated URLs, or the NONE words
export function readSources(text) {
  const rows = [];
  for (const line of text.split('\n')) {
    if (!line.startsWith('|') || /^\|\s*-/.test(line)) continue;
    const cells = line.split('|').slice(1, -1).map((c) => c.trim());
    if (cells.length < 2 || cells[0] === 'Source') continue;
    const feeds = cells[1].match(/https:\/\/[^\s,|)>]+/g) || [];
    rows.push({ name: cells[0], feeds, none: feeds.length === 0 && cells[1].toLowerCase().includes(NONE), note: cells[2] || '' });
  }
  return rows;
}

const decode = (s) => String(s ?? '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]*>/g, ' ')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&')
  .replace(/\s+/g, ' ').trim();
const tag = (block, name) => (block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i')) || [])[1];

// RSS <item> or Atom <entry>: { title, link, date, text }
export function readFeed(xml) {
  const out = [];
  for (const m of xml.matchAll(/<(item|entry)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/gi)) {
    const b = m[2];
    const atomLink = (b.match(/<link\b[^>]*\brel=["']alternate["'][^>]*>/i) || b.match(/<link\b[^>]*\bhref=[^>]*>/i) || [])[0];
    const link = atomLink ? (atomLink.match(/href=["']([^"']+)["']/i) || [])[1] : decode(tag(b, 'link'));
    const when = decode(tag(b, 'pubDate') ?? tag(b, 'published') ?? tag(b, 'updated') ?? tag(b, 'dc:date'));
    const date = new Date(when);
    out.push({
      title: decode(tag(b, 'title')),
      link: link || '',
      date: Number.isNaN(date.getTime()) ? null : date,
      text: decode(tag(b, 'description') ?? tag(b, 'summary') ?? tag(b, 'content') ?? ''),
    });
  }
  return out;
}

export const matches = (e) => TERMS.filter(([, re]) => re.test(`${e.title} ${e.text}`)).map(([t]) => t);

// the newest "Checked: YYYY-MM-DD" of an earlier research file in dir, or null
export function lastCheck(dir, release) {
  if (!fs.existsSync(dir)) return null;
  let best = null;
  for (const f of fs.readdirSync(dir)) {
    if (!/^gate6-.+-research\.md$/.test(f) || f === `gate6-${release}-research.md`) continue;
    const d = (fs.readFileSync(path.join(dir, f), 'utf8').match(/^Checked: (\d{4}-\d\d-\d\d)/m) || [])[1];
    if (d && (!best || d > best)) best = d;
  }
  return best;
}

export async function research({ release, sources, since, now, fetch }) {
  const lines = [`# Gate 6 research for ${release}`, '', `Checked: ${now.toISOString().slice(0, 10)}, for entries since ${since.toISOString().slice(0, 10)}.`, '',
    'Each source on the watch list, and its entries that mention red-green, fail on base, test tamper, a weakened test or a skipped test. Ryan reads this and writes the Window line.', ''];
  let found = 0;
  for (const s of sources) {
    lines.push(`## ${s.name}`, '');
    if (s.note) lines.push(s.note, '');
    if (s.none) { lines.push(`No public changelog found.`, ''); continue; }
    const hits = [];
    let read = 0;
    for (const url of s.feeds) {
      let xml;
      try {
        const res = await fetch(url, { headers: { accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml' } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        xml = await res.text();
        read += 1;
      } catch (e) { lines.push(`- Could not read ${url}: ${e.message}`); continue; }
      const entries = readFeed(xml);
      // a feed holds only its newest entries: when the oldest is after the cut, the gap is said, not hidden
      const dates = entries.map((e) => e.date).filter(Boolean);
      const oldest = dates.length ? new Date(Math.min(...dates)) : null;
      if (oldest && oldest > since) lines.push(`- ${url} reaches back only to ${oldest.toISOString().slice(0, 10)}; earlier entries are not covered.`);
      for (const e of entries) {
        if (!e.date || e.date < since) continue;
        const m = matches(e);
        if (m.length) hits.push({ ...e, m });
      }
    }
    hits.sort((a, b) => b.date - a.date);
    for (const h of hits) lines.push(`- ${h.date.toISOString().slice(0, 10)} [${h.title}](${h.link}): ${h.m.join(', ')}`);
    // nothing matched is a finding only when a feed was read
    if (!hits.length && read) lines.push('- Nothing matched since the last check.');
    found += hits.length;
    lines.push('');
  }
  return { text: lines.join('\n'), found };
}

export async function main(argv, { root, fetch = globalThis.fetch, now = new Date() } = {}) {
  const release = argv[0] && !argv[0].startsWith('--') ? argv[0] : undefined;
  if (!release || !/^[A-Za-z0-9._-]+$/.test(release)) { console.error('usage: node tools/gate6.mjs <release> [--since YYYY-MM-DD] [--sources <file>] [--out <file>]'); return 2; }
  const opt = (k) => { const i = argv.indexOf(k); return i < 0 ? undefined : argv[i + 1]; };
  const gates = path.join(root, 'docs/gates');
  const sourcesFile = path.resolve(root, opt('--sources') || 'docs/gates/gate6-sources.md');
  const sources = readSources(fs.readFileSync(sourcesFile, 'utf8'));
  const last = opt('--since') || lastCheck(gates, release);
  const since = last ? new Date(`${last}T00:00:00Z`) : new Date(now.getTime() - 90 * DAY);
  const { text, found } = await research({ release, sources, since, now, fetch });
  const out = path.resolve(root, opt('--out') || `docs/gates/gate6-${release}-research.md`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, text);
  console.log(JSON.stringify({ wrote: path.relative(root, out), sources: sources.length, matched: found }));
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2), { root: fileURLToPath(new URL('..', import.meta.url)) });
}
