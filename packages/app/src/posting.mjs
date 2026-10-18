// The posting switch (R5, PV-A11; APP-19, #107): every write to GitHub reads the switch from the D1 table
// flags (key TEXT PRIMARY KEY, value TEXT NOT NULL). D1 sends every query to its one primary, with no replicas, so the
// read after a write sees it at every location: turning the switch off stops all posting from the next read, with no
// deploy. Workers KV could not promise that: a write reaches other locations "up to 60 seconds or more" later, and a
// get is cached where it is read for 60 s, so /health could read off while a delivery elsewhere still read on (#107).
export const SWITCH = "posting_enabled";

// The switch's rows: the global row posting_enabled is on only when it reads "on", so a missing row is off and an
// unseeded database never posts; the installation's row posting_enabled:<id> is off only when it reads "off". A read
// that fails throws, so a run fails closed and its delivery waits in the queue.
export async function readSwitch(db, installationId) {
  const keys = installationId === undefined ? [SWITCH] : [SWITCH, `${SWITCH}:${installationId}`];
  const { results } = await db.prepare(`SELECT key, value FROM flags WHERE key IN (${keys.map(() => "?").join(", ")})`).bind(...keys).all();
  const row = (key) => results.find((r) => r.key === key)?.value;
  return { global: row(SWITCH) === "on", installation: row(`${SWITCH}:${installationId}`) !== "off" };
}

// Reads .github/truedone.yml's enabled key for the repository (default true) and the switch's two rows. Any that is
// off stops the write. configText may be the text or the promise of its read: the switch and the config are read
// together (APP-15), and their answers are taken in the same order as before.
export async function postingAllowed(env, { installationId, repository, configText }) {
  const [flags, text] = await Promise.all([readSwitch(env.FLAGS, installationId), configText]);
  if (!flags.global) return { allowed: false, reason: "posting_disabled" };
  if (!flags.installation) return { allowed: false, reason: "posting_disabled" };
  const cfg = parseConfig(text);
  if (cfg.enabled === "false") return { allowed: false, reason: "repo_disabled" };
  return { allowed: true };
}

// .github/truedone.yml: flat key: value lines only, no YAML library (spec, Configuration).
// Unknown keys are returned so the caller can name them in a reason line.
export function parseConfig(text) {
  const cfg = {};
  const unknown = [];
  if (typeof text !== "string") return { ...cfg, unknown };
  for (const line of text.split("\n")) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.+?)\s*$/);
    if (!m || line.trim().startsWith("#")) continue;
    const [, key, value] = m;
    if (["test", "comments", "conclusion", "ignore", "enabled"].includes(key)) cfg[key] = value;
    else unknown.push(key);
  }
  cfg.unknown = unknown;
  return cfg;
}

// The daily sweep: a raced delivery can write a key after uninstall's list, so the
// cron re-runs the same deletion for every installation seen removed (R6, PV-R06).
export async function sweepLeftovers(env, installationId) {
  const removed = await deleteInstallationData(env, installationId);
  await env.KV.delete(`removed:${installationId}`);
  return removed;
}

export async function markRemoved(env, installationId) {
  await env.KV.put(`removed:${installationId}`, "1");
}

// APP-17's cache of the installation token, kept in KV under its own prefix, outside <id>: (index.mjs).
export const tokenKey = (installationId) => `token:${installationId}`;

// Workers KV pages its list: { keys, list_complete, cursor }. listKeys walks
// every page, following the cursor (APP-09), so nothing past a page boundary
// is missed. Keys arrive as objects { name }.
export async function listKeys(kv, opts) {
  const out = [];
  let cursor;
  do {
    const page = await kv.list(cursor === undefined ? opts : { ...opts, cursor });
    for (const key of page?.keys ?? []) out.push(typeof key === "string" ? key : key.name);
    cursor = page?.list_complete ? undefined : page?.cursor;
  } while (cursor !== undefined);
  return out;
}

// installation.deleted: delete the installation's KV keys, its kept token and its switch row at once (R6, PV-R06;
// the intake calls it, APP-24). The daily sweep (a Worker cron) runs the same deletion for anything left. It returns the
// number of <id>: keys deleted.
export async function deleteInstallationData(env, installationId) {
  const prefix = `${installationId}:`;
  const names = await listKeys(env.KV, { prefix });
  for (const name of names) await env.KV.delete(name);
  await env.KV.delete(tokenKey(installationId));
  // the installation's switch row (APP-19)
  await env.FLAGS.prepare("DELETE FROM flags WHERE key = ?").bind(`${SWITCH}:${installationId}`).run();
  return names.length;
}
