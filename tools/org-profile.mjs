// node tools/org-profile.mjs <snapshot.json> <page.md> (ORG-02): writes the organisation profile page from a metrics
// snapshot (MET-01): the name, one sentence of value in at most 25 words, one line on trying it, a table of exactly eight
// headline metrics with figure, window, source and sample size (the words Not yet measured, with the reason, where the
// snapshot has no source), and a second table of the public figures the snapshot does carry. The page is held to the
// owner's bar: at most 60 lines, plain ASCII, no figure without a source, no em or en dash, none of the marketing words in
// BANNED. --check <snapshot.json> <page.md> writes nothing and exits 1 when the page breaks a rule or is not byte for byte
// what this script writes from the snapshot. No dependencies, no network.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const MAX_LINES = 60;
export const MAX_VALUE_WORDS = 25;
export const BANNED = ['revolutionary', 'seamless', 'powerful', 'cutting-edge', 'leverage', 'robust', 'unlock', 'supercharge', 'game-changing'];
export const HEADLINE = [
  ['Repositories integrated', 'repositories_running_truedone'],
  ['Active in 30 days', 'active_integrations_30d'],
  ['Pull requests checked', 'pull_requests_checked'],
  ['Faults caught beyond CI', 'faults_caught_beyond_ci'],
  ['False alarm rate', 'false_alarm_rate'],
  ['Verification success rate', 'verification_success_rate'],
  ['30-day retention', 'retention_30d'],
  ['Weekly growth', 'weekly_growth'],
];
// the public figures shown under Measured today, with the unit each is shown in; the workflow figures stay off the page,
// since they add the sandbox's runs, which fail by design (its cases are red)
const TODAY = [
  ['Public repositories', 'public_repositories', 'count'],
  ['Open issues', 'open_issues', 'count'],
  ['Pull requests opened', 'pull_requests_opened_in_window', 'count'],
  ['Hours to a first issue response, median', 'median_hours_to_first_issue_response', 'hours'],
];
export const HEADER = '| Metric | Figure | Window | Source | Sample |';
const RULE = '|---|---|---|---|---|';
const NOT_YET = 'Not yet measured';
const VALUE = 'Truedone shows whether a pull request\'s tests prove its change: red without it, green with it, and nothing weakened on the way.';

const day = (iso) => iso.slice(0, 10);
const windowText = (w) => (w.at ? `on ${day(w.at)}` : `${day(w.from)} to ${day(w.to)}`);
const sourceText = (s) => {
  const urls = s.split(' ');
  const host = urls[0].replace(/^https:\/\//, '').split('?')[0];
  return urls.length === 1 ? `[${host}](${urls[0]})` : `[${host}](${urls[0]}) and ${urls.length - 1} more`;
};
const figureText = (f, unit) => {
  if (f.value === null) return 'No sample';
  if (unit === 'rate') return `${Math.round(f.value * 1000) / 10}%`;
  if (unit === 'hours') return `${f.value} h`;
  return String(f.value);
};

export function generate(snapshot) {
  const reasons = Object.fromEntries((snapshot.not_yet_measured || []).map((x) => [x.name, x.reason]));
  const headline = HEADLINE.map(([label, name]) => {
    const f = snapshot.figures[name];
    if (f) return `| ${label} | ${figureText(f, name.endsWith('rate') ? 'rate' : 'count')} | ${windowText(f.window)} | ${sourceText(f.source)} | ${f.n} |`;
    if (!Object.hasOwn(reasons, name)) throw new Error(`the snapshot neither measures ${name} nor says why not`);
    return `| ${label} | ${NOT_YET} | | ${reasons[name]} | |`;
  });
  const today = TODAY.flatMap(([label, name, unit]) => {
    const f = snapshot.figures[name];
    return f ? [`| ${label} | ${figureText(f, unit)} | ${windowText(f.window)} | ${sourceText(f.source)} | ${f.n} |`] : [];
  });
  return [
    '# Truedone',
    '',
    VALUE,
    '',
    'Try it on any public pull request: open truedone.pages.dev/owner/repo/pull/n. Nothing to install.',
    '',
    '## What we measure',
    '',
    'Each figure carries the window it covers, the source it was read from and the sample it rests on. A metric with no honest source yet says so, with the reason.',
    '',
    HEADER, RULE, ...headline,
    '',
    '## Measured today',
    '',
    `Public GitHub data for this organisation, read ${day(snapshot.generated_at)}. Visibility and activity, not adoption.`,
    '',
    HEADER, RULE, ...today,
    '',
    `Definitions and limits: [docs/ops/metrics.md](https://github.com/${snapshot.organisation}/truedone/blob/main/docs/ops/metrics.md). Source: [Truedone/truedone](https://github.com/${snapshot.organisation}/truedone).`,
    '',
  ].join('\n');
}

// the rules every page must meet, as a list of misses
export function problems(page, snapshot) {
  const out = [];
  const lines = page.split('\n');
  if (lines.length - 1 > MAX_LINES) out.push(`${lines.length - 1} lines, more than ${MAX_LINES}`);
  if (lines[0] !== '# Truedone') out.push('line 1 is not "# Truedone"');
  const value = lines.slice(1).find((l) => l.trim());
  const words = value ? value.trim().split(/\s+/).length : 0;
  if (!value || words > MAX_VALUE_WORDS) out.push(`the value sentence has ${words} words, more than ${MAX_VALUE_WORDS}`);
  if (!page.includes('truedone.pages.dev')) out.push('no line says how to try it');
  if (/[\u2013\u2014]/.test(page)) out.push('an em or en dash');
  if (/[^\x09\x0a\x20-\x7e]/.test(page)) out.push('a character outside plain ASCII');
  for (const w of BANNED) if (new RegExp(`\\b${w.replace('-', '[- ]')}\\b`, 'i').test(page)) out.push(`the word ${w}`);
  const tables = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] !== HEADER) continue;
    const rows = [];
    for (let j = i + 2; j < lines.length && lines[j].startsWith('|'); j++) rows.push(lines[j]);
    tables.push(rows);
  }
  if (tables.length < 1) out.push('no metrics table');
  if (tables.length && tables[0].length !== HEADLINE.length) out.push(`the headline table has ${tables[0].length} rows, not ${HEADLINE.length}`);
  for (const row of tables.flat()) {
    const cells = row.split('|').slice(1, -1).map((c) => c.trim());
    if (cells.length !== 5) { out.push(`a row has ${cells.length} cells: ${row}`); continue; }
    const [, figure, window, source, sample] = cells;
    if (figure === NOT_YET) { if (!source) out.push(`${cells[0]}: not yet measured without a reason`); continue; }
    if (!/^(No sample|[0-9][0-9.]*( h|%)?)$/.test(figure)) out.push(`${cells[0]}: figure "${figure}" is neither a number nor ${NOT_YET}`);
    if (!window || !source || !/^[0-9]+$/.test(sample)) out.push(`${cells[0]}: a figure without its window, source or sample`);
  }
  if (snapshot && page !== generate(snapshot)) out.push('the page is not what the generator writes from the snapshot');
  return out;
}

export function main(argv = process.argv.slice(2)) {
  const check = argv[0] === '--check';
  const [snapFile, pageFile] = check ? argv.slice(1) : argv;
  if (!snapFile || !pageFile) { console.error('usage: node tools/org-profile.mjs [--check] <snapshot.json> <page.md>'); return 2; }
  const snapshot = JSON.parse(fs.readFileSync(snapFile, 'utf8'));
  if (check) {
    const page = fs.existsSync(pageFile) ? fs.readFileSync(pageFile, 'utf8') : '';
    const bad = problems(page, snapshot);
    for (const b of bad) console.error(`${pageFile}: ${b}`);
    if (!bad.length) console.log(`${pageFile}: ${page.split('\n').length - 1} lines, ${HEADLINE.length} headline rows, every figure sourced, equals the generator`);
    return bad.length ? 1 : 0;
  }
  const page = generate(snapshot);
  const bad = problems(page, snapshot);
  if (bad.length) { for (const b of bad) console.error(b); return 1; }
  fs.mkdirSync(path.dirname(path.resolve(pageFile)), { recursive: true });
  fs.writeFileSync(pageFile, page);
  console.log(`${pageFile}: written, ${page.split('\n').length - 1} lines`);
  return 0;
}

if (process.argv[1] && fs.realpathSync(path.resolve(process.argv[1])) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  process.exit(main());
}
