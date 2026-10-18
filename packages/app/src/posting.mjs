// The posting switch (R5, PV-A11): every write to GitHub reads the flag uncached,
// so turning it off stops all posting within one minute with no deploy.

// Reads .github/truedone.yml's enabled key for the repository (default true), the
// installation-wide KV flag posting_enabled:<id> (default on) and the one global
// KV key posting_enabled (default on; APP-09), each read uncached. Any that is
// off stops the write.
export async function postingAllowed(env, { installationId, repository, configText }) {
  const global = await env.KV.get("posting_enabled");
  if (global === "off") return { allowed: false, reason: "posting_disabled" };
  const perInstall = await env.KV.get(`posting_enabled:${installationId}`);
  if (perInstall === "off") return { allowed: false, reason: "posting_disabled" };
  const cfg = parseConfig(configText);
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

// installation.deleted: delete the installation's KV keys at once (R6, PV-R06).
// The daily sweep (a Worker cron) removes anything left; both share listDelete.
export async function deleteInstallationData(env, installationId) {
  const prefix = `${installationId}:`;
  const names = await listKeys(env.KV, { prefix });
  for (const name of names) await env.KV.delete(name);
  await env.KV.delete(`posting_enabled:${installationId}`);
  return names.length;
}
