import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { classify } from '../src/classify.mjs';

const RECORD = 'truedone-restore';

function gitDir(root) {
  const dot = path.join(root, '.git');
  if (fs.statSync(dot).isDirectory()) return dot;
  const text = fs.readFileSync(dot, 'utf8');
  const found = /^gitdir:\s*(.+)$/m.exec(text);
  if (!found) throw new Error(`no git directory at ${root}`);
  return path.resolve(path.dirname(dot), found[1].trim());
}

function recordPath(root) {
  return path.join(gitDir(root), RECORD);
}

function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

function readBytes(root, rel) {
  const abs = path.join(root, rel);
  return fs.existsSync(abs) ? fs.readFileSync(abs) : null;
}

function writeBytes(root, rel, buf) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, buf);
}

function removeFile(root, rel) {
  const abs = path.join(root, rel);
  if (fs.existsSync(abs)) fs.unlinkSync(abs);
}

function asBuffer(value) {
  if (value == null) return Buffer.alloc(0);
  return Buffer.isBuffer(value) ? value : Buffer.from(String(value));
}

export function readRecord(root) {
  const file = recordPath(root);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function expectedNow(entry) {
  if (entry.action === 'remove') return null;
  return Buffer.from(entry.swapped, 'base64');
}

function same(buf, hash) {
  if (buf == null) return hash == null;
  return sha256(buf) === hash;
}

export function restore(root) {
  const rec = readRecord(root);
  if (!rec) return { restored: false, files: [] };
  const drifted = [];
  for (const entry of rec.files) {
    const now = readBytes(root, entry.path);
    const swapped = expectedNow(entry);
    const atSwap = same(now, swapped ? sha256(swapped) : null);
    const atHead = same(now, entry.headSha);
    if (!atSwap && !atHead) drifted.push(entry.path);
  }
  if (drifted.length) {
    const err = new Error(`a file changed during the run: ${drifted.join(', ')}`);
    err.files = drifted;
    throw err;
  }
  for (const entry of rec.files) {
    if (entry.head == null) removeFile(root, entry.path);
    else writeBytes(root, entry.path, Buffer.from(entry.head, 'base64'));
    const back = readBytes(root, entry.path);
    if (!same(back, entry.headSha)) throw new Error(`hash mismatch after writing ${entry.path}`);
  }
  fs.unlinkSync(recordPath(root));
  return { restored: true, files: rec.files.map((entry) => entry.path) };
}

// S1, PV-L05 (CLI-07): a run that finds the record restores first. The CLI's --run calls this before it reads the tree,
// so the files of a run killed mid-way come back from .git/truedone-restore; with no record it does nothing.
export function restorePending(root) {
  return restore(root);
}

export function swapToBase({ root, files, classify: classifyFn = classify }) {
  if (readRecord(root)) restore(root);
  const chosen = [];
  for (const file of files || []) {
    if (classifyFn(file.path) !== 'source') continue;
    const status = file.status || 'modified';
    const headBuf = readBytes(root, file.path);
    const baseBuf = asBuffer(file.base);
    const action = status === 'added' ? 'remove' : 'write';
    chosen.push({
      path: file.path,
      action,
      head: headBuf ? headBuf.toString('base64') : null,
      headSha: headBuf ? sha256(headBuf) : null,
      swapped: action === 'remove' ? null : baseBuf.toString('base64'),
    });
  }
  fs.writeFileSync(recordPath(root), JSON.stringify({ files: chosen }));
  for (const entry of chosen) {
    if (entry.action === 'remove') removeFile(root, entry.path);
    else writeBytes(root, entry.path, Buffer.from(entry.swapped, 'base64'));
  }
  return { swapped: chosen.map((entry) => entry.path) };
}
