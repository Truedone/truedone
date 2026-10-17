// The same walk as the contract dependency check. A package.json outside a
// test/fixtures directory fails when it declares any dependency.
import fs from 'node:fs';
import path from 'node:path';

const keys = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies', 'bundledDependencies', 'bundleDependencies'];
const root = path.resolve(process.argv[2] || path.join(path.dirname(new URL(import.meta.url).pathname), '..'));
const bad = [];

function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (e.name === '.git' || e.name === 'node_modules') continue;
    const f = path.join(d, e.name);
    if (e.isDirectory()) {
      if (/test[\\/]fixtures$/.test(f)) continue;
      walk(f);
    } else if (e.name === 'package.json') {
      const j = JSON.parse(fs.readFileSync(f, 'utf8'));
      for (const k of keys) if (j[k] && Object.keys(j[k]).length) bad.push(`${f} ${k}`);
    }
  }
}

walk(root);
if (bad.length) {
  console.error(bad.join('\n'));
  process.exit(1);
}
