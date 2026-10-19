// MET-02: the metrics workflow runs tools/misses/tally.mjs on the collected snapshot, writing it back, after
// tools/metrics/collect.mjs and before tools/metrics/check.mjs, with the same workflow token, and all three run before the
// step that writes the snapshot to metrics-data, so the snapshot written there carries the wrong-verdict counts (D39). The
// test reads .github/workflows/metrics.yml as text: each step's name, env and run lines, in order. The same reading
// refuses a workflow that drops the tally, runs it after the check, on another file, without the token, or after the write.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const yml = fs.readFileSync(new URL('../../.github/workflows/metrics.yml', import.meta.url), 'utf8');

// the steps of the workflow's one job, in order: { name, env, run: [command lines] }
export function steps(text) {
  const lines = text.split('\n');
  const at = lines.findIndex((l) => /^\s*steps:\s*$/.test(l));
  if (at < 0) return [];
  const indent = (l) => l.length - l.trimStart().length;
  const base = indent(lines[at]);
  const out = [];
  let step = null;
  let block = null;
  for (let i = at + 1; i < lines.length; i++) {
    const l = lines[i];
    if (!l.trim()) continue;
    const d = indent(l);
    if (d <= base) break;
    const t = l.trim();
    if (t.startsWith('- ') && (!step || d <= step.indent)) {
      step = { indent: d, name: null, env: {}, run: [] };
      out.push(step);
      block = null;
    }
    const body = t.startsWith('- ') && d === step.indent ? t.slice(2) : t;
    const key = d === step.indent || d === step.indent + 2 ? /^([A-Za-z_-]+):\s*(.*)$/.exec(body) : null;
    if (key) {
      block = null;
      if (key[1] === 'name') step.name = key[2];
      else if (key[1] === 'env') block = { kind: 'env', indent: d };
      else if (key[1] === 'run' && /^[|>]-?$/.test(key[2])) block = { kind: 'run', indent: d };
      else if (key[1] === 'run') step.run.push(key[2]);
      continue;
    }
    if (block && d > block.indent) {
      if (block.kind === 'run') step.run.push(t);
      else { const kv = /^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/.exec(t); if (kv) step.env[kv[1]] = kv[2]; }
    }
  }
  return out;
}

// the misses in the workflow's order, as a list
export function problems(text) {
  const out = [];
  const all = steps(text);
  const find = (re) => {
    for (let s = 0; s < all.length; s++) for (let c = 0; c < all[s].run.length; c++) { const m = re.exec(all[s].run[c]); if (m) return { s, c, m, step: all[s] }; }
    return null;
  };
  const before = (a, b) => a.s < b.s || (a.s === b.s && a.c < b.c);
  const collect = find(/^node tools\/metrics\/collect\.mjs\b.*--out (\S+)/);
  const tally = find(/^node tools\/misses\/tally\.mjs --snapshot (\S+) --out (\S+)$/);
  const check = find(/^node tools\/metrics\/check\.mjs (\S+)$/);
  const write = all.findIndex((s) => s.run.some((r) => /HEAD:metrics-data\b/.test(r)));
  if (!collect) out.push('no step runs the collector with --out');
  if (!tally) out.push('no step runs tools/misses/tally.mjs --snapshot <file> --out <file>');
  if (!check) out.push('no step runs the check on a file');
  if (write < 0) out.push('no step writes the snapshot to metrics-data');
  if (!collect || !tally || !check || write < 0) return out;
  const file = collect.m[1];
  if (tally.m[1] !== file || tally.m[2] !== file) out.push(`the tally reads ${tally.m[1]} and writes ${tally.m[2]}, not the collected ${file}`);
  if (check.m[1] !== file) out.push(`the check reads ${check.m[1]}, not the collected ${file}`);
  if (!before(collect, tally)) out.push('the tally runs before the collector');
  if (!before(tally, check)) out.push('the tally runs after the check');
  for (const [what, x] of [['collector', collect], ['tally', tally], ['check', check]]) if (x.s >= write) out.push(`the ${what} runs in or after the step that writes metrics-data`);
  if (!all[write].run.some((r) => r.startsWith(`cp ${file} `) && r.includes('metrics/latest.json'))) out.push(`the step that writes metrics-data does not copy ${file}`);
  const token = '${{ secrets.GITHUB_TOKEN }}';
  if (collect.step.env.GITHUB_TOKEN !== token) out.push('the collector does not have the workflow token');
  if (tally.step.env.GITHUB_TOKEN !== token) out.push('the tally does not have the workflow token');
  return out;
}

test('the workflow collects, tallies the same file, then checks it, with the workflow token, before the snapshot is written', () => {
  const all = steps(yml);
  const flat = all.flatMap((s, i) => s.run.map((r) => [i, r]));
  const at = (re) => flat.findIndex(([, r]) => re.test(r));
  const c = at(/^node tools\/metrics\/collect\.mjs /);
  const t = at(/^node tools\/misses\/tally\.mjs /);
  const k = at(/^node tools\/metrics\/check\.mjs /);
  assert.ok(c >= 0 && t >= 0 && k >= 0, 'the collector, the tally and the check all run');
  assert.ok(c < t && t < k, `the order is collect ${c}, tally ${t}, check ${k}`);
  assert.equal(flat[t][1], 'node tools/misses/tally.mjs --snapshot /tmp/latest.json --out /tmp/latest.json');
  const write = all.findIndex((s) => s.name === 'Write the snapshot to metrics-data');
  assert.ok(write >= 0, 'the write step is there');
  for (const i of [c, t, k]) assert.ok(flat[i][0] < write, `${flat[i][1]} runs before the write step`);
  assert.equal(all[flat[t][0]].env.GITHUB_TOKEN, '${{ secrets.GITHUB_TOKEN }}');
  assert.equal(all[flat[t][0]].env.GITHUB_TOKEN, all[flat[c][0]].env.GITHUB_TOKEN, 'the tally has the collector\'s token');
  assert.deepEqual(problems(yml), []);
});

test('the reading refuses a workflow with no tally, a tally after the check or on another file, without the token, or after the write', () => {
  const line = '          node tools/misses/tally.mjs --snapshot /tmp/latest.json --out /tmp/latest.json\n';
  assert.ok(yml.includes(line));
  const check = '          node tools/metrics/check.mjs /tmp/latest.json\n';
  const miss = (text) => problems(text).join('\n');
  assert.match(miss(yml.replace(line, '')), /no step runs tools\/misses\/tally\.mjs/);
  assert.match(miss(yml.replace(line + check, check + line)), /the tally runs after the check/);
  assert.match(miss(yml.replace(line, line.replace('--out /tmp/latest.json', '--out /tmp/other.json'))), /writes \/tmp\/other\.json, not the collected \/tmp\/latest\.json/);
  assert.match(miss(yml.replace('          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}\n', '')), /the tally does not have the workflow token/);
  assert.match(miss(yml.replace(line, '').replace('          mkdir -p /tmp/data/metrics/history\n', `          mkdir -p /tmp/data/metrics/history\n${line}`)), /the tally runs in or after the step that writes metrics-data/);
  assert.match(miss(yml.replace('cp /tmp/latest.json /tmp/data/metrics/latest.json', 'cp /tmp/other.json /tmp/data/metrics/latest.json')), /does not copy \/tmp\/latest\.json/);
  assert.deepEqual(problems(yml), []);
});
