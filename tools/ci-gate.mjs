// The CI gate (SEC-01, D22/D27): re-run one task's criteria from the SIGNED contract
// on origin/main, never from the PR. Node only, no dependencies.
//   1. the task id comes from the PR title prefix ("CORE-01: ...");
//   2. a PR that touches .proofline/ is refused;
//   3. proofline.json, proofline.json.sig and guard/ are restored from origin/main;
//   4. the signature is verified BEFORE anything is removed;
//   5. a CI copy of the contract drops exactly the task's ci.env_bound criteria, which
//      are printed (they need an account or a live service and run on the lane machine);
//   6. guard/owner.pub leaves the checkout only after the signature check;
//   7. the pinned proofline gates the task with --skip-pushed --fresh and this gate
//      exits with its code. Never the ci flag: proofline gates ci.tasks with that, not a named task.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export const PROOFLINE_PIN = '@optitransfer/proofline@0.2.0-next.1';

export function parseTaskId(title) {
  const m = String(title || '').match(/^([A-Z]+-\d+[A-Z]*):\s/);
  if (!m) throw new Error('gate: the PR title must start with the task id, like "CORE-01: ..."');
  return m[1];
}

export function touchesProofline(files) {
  return files.some((f) => f.split('/')[0] === '.proofline');
}

export function stripEnvBound(contract, taskId) {
  const drop = new Set(((contract.ci || {}).env_bound || {})[taskId] || []);
  const copy = JSON.parse(JSON.stringify(contract));
  const removed = [];
  const task = (copy.tasks || []).find((t) => t.id === taskId);
  if (!task) throw new Error(`gate: the contract has no task ${taskId}`);
  task.criteria = (task.criteria || []).filter((c) => {
    if (drop.has(c.id)) { removed.push(c.id); return false; }
    return true;
  });
  // The ids leave the copy entirely: the env-bound map no longer names them either.
  if (copy.ci && copy.ci.env_bound && copy.ci.env_bound[taskId]) {
    copy.ci.env_bound[taskId] = (copy.ci.env_bound[taskId] || []).filter((id) => !drop.has(id));
    if (!copy.ci.env_bound[taskId].length) delete copy.ci.env_bound[taskId];
  }
  for (const id of drop) if (!removed.includes(id)) removed.push(id);
  return { contract: copy, removed };
}

// deps: { git, run, readMain, write, remove, now } injected so tests drive everything.
export function makeGate(deps) {
  const { git, run, readMain, write, remove, log } = deps;
  return async function gate({ title, changedFiles }) {
    const taskId = parseTaskId(title);
    if (touchesProofline(changedFiles || [])) {
      throw new Error('gate: a PR that touches .proofline/ is refused (D22)');
    }
    // 3. the contract, its signature and the guard come from origin/main, never the PR.
    const contractText = readMain('proofline.json');
    const sigText = readMain('proofline.json.sig');
    const ownerPub = readMain('guard/owner.pub');
    fs.mkdirSync('guard', { recursive: true });
    write('proofline.json', contractText);
    write('proofline.json.sig', sigText);
    if (ownerPub !== undefined) write('guard/owner.pub', ownerPub);
    // 4. the signature is checked before anything is removed; a failed check stops here.
    const verified = run(`npx --yes ${PROOFLINE_PIN} contract verify-sig`);
    if (verified.code !== 0) throw new Error('gate: the contract signature check failed (verify-sig)');
    const contract = JSON.parse(contractText);
    const { contract: ciContract, removed } = stripEnvBound(contract, taskId);
    log(`env-bound criteria skipped and printed: ${JSON.stringify(removed)}`);
    // 6. only after the signature check does the checkout lose the owner key.
    if (ownerPub !== undefined) remove('guard/owner.pub');
    write('proofline.json', JSON.stringify(ciContract, null, 2) + '\n');
    // 7. the pinned proofline gates the named task on this tree; never the ci flag.
    const base = git('merge-base', 'HEAD', 'origin/main');
    const code = run(`npx --yes ${PROOFLINE_PIN} gate ${taskId} --skip-pushed --fresh --base "${base}"`).code;
    return code;
  };
}

function sh(gitArgs) {
  return execFileSync('git', gitArgs, { encoding: 'utf8' }).trim();
}

export function listChangedFiles() {
  const base = sh(['merge-base', 'HEAD', 'origin/main']);
  return sh(['diff', '--name-only', base, 'HEAD']).split('\n').filter(Boolean);
}

export async function main() {
  const title = process.env.PR_TITLE || '';
  const changed = listChangedFiles();
  const gate = makeGate({
    git: (...a) => sh(a),
    run: (cmd) => { try { execFileSync('sh', ['-c', cmd], { stdio: 'inherit' }); return { code: 0 }; } catch (e) { return { code: e.status ?? 1 }; } },
    readMain: (p) => { try { return sh(['show', `origin/main:${p}`]); } catch { return undefined; } },
    write: (p, c) => fs.mkdirSync(path.dirname(p), { recursive: true }) || fs.writeFileSync(p, c),
    remove: (p) => fs.rmSync(p, { force: true }),
    log: (m) => console.log(m),
  });
  const code = await gate({ title, changedFiles: changed });
  process.exit(code);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.url.replace('file://', ''))) {
  await main();
}
