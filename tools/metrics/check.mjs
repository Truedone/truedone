// node tools/metrics/check.mjs <snapshot.json> (MET-01): holds a metrics snapshot to its shape. Every figure has a numeric
// value (or null when its sample is empty), a window (a from and to, or a point in time), an https source and an integer
// sample size; the eight names under not_yet_measured are present with a reason, and none of them is also a figure; the
// generated_at is a date. Exits 1 and prints each miss, one a line. No dependencies, no network.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SCHEMA, NOT_YET_MEASURED } from './collect.mjs';

const isDate = (s) => typeof s === 'string' && !Number.isNaN(Date.parse(s));
const isUrl = (s) => typeof s === 'string' && s.split(' ').every((u) => /^https:\/\/[^\s]+$/.test(u));

export function problems(snapshot) {
  const out = [];
  if (!snapshot || typeof snapshot !== 'object') return ['the snapshot is not an object'];
  if (snapshot.schema !== SCHEMA) out.push(`schema is ${JSON.stringify(snapshot.schema)}, not ${SCHEMA}`);
  if (!isDate(snapshot.generated_at)) out.push('generated_at is not a date');
  if (typeof snapshot.organisation !== 'string' || !snapshot.organisation) out.push('organisation is missing');
  const figures = snapshot.figures && typeof snapshot.figures === 'object' ? snapshot.figures : null;
  if (!figures) out.push('figures is missing');
  for (const [name, f] of Object.entries(figures || {})) {
    if (!f || typeof f !== 'object') { out.push(`${name}: not an object`); continue; }
    if (!(typeof f.value === 'number' && Number.isFinite(f.value)) && f.value !== null) out.push(`${name}: value is not a number or null`);
    if (f.value === null && f.n !== 0) out.push(`${name}: a null value needs an empty sample (n 0)`);
    const w = f.window;
    const point = w && typeof w === 'object' && isDate(w.at) && Object.keys(w).length === 1;
    const range = w && typeof w === 'object' && isDate(w.from) && isDate(w.to) && w.from <= w.to;
    if (!point && !range) out.push(`${name}: window is neither a point in time nor a from and to`);
    if (!isUrl(f.source)) out.push(`${name}: source is not an https URL`);
    if (!(Number.isInteger(f.n) && f.n >= 0)) out.push(`${name}: n is not a whole number`);
  }
  const nym = Array.isArray(snapshot.not_yet_measured) ? snapshot.not_yet_measured : null;
  if (!nym) out.push('not_yet_measured is missing');
  const names = new Set((nym || []).map((x) => x && x.name));
  for (const { name } of NOT_YET_MEASURED) if (!names.has(name)) out.push(`not_yet_measured lacks ${name}`);
  for (const x of nym || []) {
    if (!x || typeof x.name !== 'string' || typeof x.reason !== 'string' || !x.reason) out.push(`not_yet_measured entry ${JSON.stringify(x && x.name)} has no reason`);
    else if (figures && Object.hasOwn(figures, x.name)) out.push(`${x.name} is listed as not yet measured and carries a figure`);
  }
  return out;
}

export function main(argv = process.argv.slice(2)) {
  const file = argv[0];
  if (!file) { console.error('usage: node tools/metrics/check.mjs <snapshot.json>'); return 2; }
  let snapshot;
  try { snapshot = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { console.error(`${file}: ${e.message}`); return 1; }
  const bad = problems(snapshot);
  for (const b of bad) console.error(`${file}: ${b}`);
  if (!bad.length) console.log(`${file}: ${Object.keys(snapshot.figures).length} figures, each with a window, a source and a sample size; ${snapshot.not_yet_measured.length} not yet measured`);
  return bad.length ? 1 : 0;
}

if (process.argv[1] && fs.realpathSync(path.resolve(process.argv[1])) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  process.exit(main());
}
