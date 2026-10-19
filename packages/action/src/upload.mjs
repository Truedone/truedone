// The report uploader (ACT-02, D9; the ACT-03 v4 fix): one artifact per job
// through the Actions Results service, with the client written in this file
// and no @actions packages. The artifact holds exactly one file, the report,
// under the cap. The wire protocol is the real v4 twirp one, read from
// @actions/artifact 6.3.1: CreateArtifact names the backend ids from the
// runtime token's Actions.Results scope, the zip PUTs to the signed url as a
// block blob with no Authorization header, and FinalizeArtifact carries the
// size as a string and the zip's sha256.

import { createHash } from "node:crypto";

const MAX_BYTES = 256 * 1024;
const TWIRP = "twirp/github.actions.results.api.v1.ArtifactService";

// A minimal store-only ZIP: local file header, data, central directory, end
// record. CRC-32 is computed bitwise; the report is small, so speed is fine.
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function buildZip(fileName, contents) {
  const name = new TextEncoder().encode(fileName);
  const data = typeof contents === "string" ? new TextEncoder().encode(contents) : contents;
  const crc = crc32(data);
  const u16 = (v) => new Uint8Array([v & 255, (v >> 8) & 255]);
  const u32 = (v) => new Uint8Array([v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255]);
  const local = new Uint8Array(30 + name.length);
  local.set(u32(0x04034b50), 0);
  local.set(u16(20), 4);
  local.set(u16(0), 6);
  local.set(u16(0), 8);
  local.set(u16(0), 10);
  local.set(u16(0), 12);
  local.set(u32(crc), 14);
  local.set(u32(data.length), 18);
  local.set(u32(data.length), 22);
  local.set(u16(name.length), 26);
  local.set(name, 30);
  const central = new Uint8Array(46 + name.length);
  central.set(u32(0x02014b50), 0);
  central.set(u16(20), 4);
  central.set(u16(20), 6);
  central.set(u16(0), 8);
  central.set(u16(0), 10);
  central.set(u16(0), 14);
  central.set(u32(crc), 16);
  central.set(u32(data.length), 20);
  central.set(u32(data.length), 24);
  central.set(u16(name.length), 28);
  central.set(u32(0), 42);
  central.set(name, 46);
  // The central directory starts after the local header, its name AND the
  // data: an offset of local.length alone points into the report bytes and
  // every reader refuses the archive with a bad central directory (#160).
  const offset = local.length + data.length;
  const end = new Uint8Array(22);
  end.set(u32(0x06054b50), 0);
  end.set(u16(1), 8);
  end.set(u16(1), 10);
  end.set(u32(central.length), 12);
  end.set(u32(offset), 16);
  const out = new Uint8Array(local.length + data.length + central.length + end.length);
  let o = 0;
  out.set(local, o); o += local.length;
  out.set(data, o); o += data.length;
  out.set(central, o); o += central.length;
  out.set(end, o);
  return out;
}

export function artifactName(jobId) {
  return `truedone-report-${jobId}`;
}

// The workflow run and job run backend ids come from the runtime token's JWT
// scp claim, from the entry "Actions.Results:<runId>:<jobId>"
// (getBackendIdsFromToken in @actions/artifact's util.js).
export function backendIdsFromToken(token) {
  const parts = String(token || "").split(".");
  if (parts.length < 2 || !parts[1]) throw new Error("ACTIONS_RUNTIME_TOKEN carries no JWT payload");
  const padded = parts[1].replace(/-/g, "+").replace(/_/g, "/");
  const json = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(padded + "=".repeat((4 - (padded.length % 4)) % 4)), (c) => c.charCodeAt(0))));
  const scope = String(json.scp || "").split(" ").find((s) => s.startsWith("Actions.Results:"));
  if (!scope) throw new Error("ACTIONS_RUNTIME_TOKEN carries no Actions.Results scope");
  const [, run, job] = scope.split(":");
  if (!run || !job) throw new Error("ACTIONS_RUNTIME_TOKEN's Actions.Results scope is incomplete");
  return { workflow_run_backend_id: run, workflow_job_run_backend_id: job };
}

// The three-call client: CreateArtifact names the artifact, PUT the zip to
// the signed url as a block blob, FinalizeArtifact commits it.
// env: { ACTIONS_RUNTIME_TOKEN, ACTIONS_RESULTS_URL }.
export async function uploadReport(env, { jobId, fileName, contents }) {
  const doFetch = env.fetch ?? fetch;
  const name = artifactName(jobId);
  const zip = buildZip(fileName, contents);
  if (zip.length > MAX_BYTES) throw new Error(`report artifact over ${MAX_BYTES / 1024} KB`);
  const ids = backendIdsFromToken(env.ACTIONS_RUNTIME_TOKEN);
  const base = `${env.ACTIONS_RESULTS_URL.replace(/\/$/, "")}/${TWIRP}`;
  const jsonHeaders = {
    authorization: `Bearer ${env.ACTIONS_RUNTIME_TOKEN}`,
    "content-type": "application/json",
  };
  const create = await doFetch(`${base}/CreateArtifact`, {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({ ...ids, name, version: 4 }),
  });
  if (!create.ok) throw Object.assign(new Error(`artifact create ${create.status}`), { status: create.status });
  const created = await create.json();
  if (!created.ok) throw new Error("artifact create was not ok");
  if (!created.signed_upload_url) throw new Error("artifact create returned no signed upload url");
  const put = await doFetch(created.signed_upload_url, {
    method: "PUT",
    headers: {
      "content-type": "application/zip",
      "x-ms-blob-type": "BlockBlob",
    },
    body: zip,
  });
  if (!put.ok) throw Object.assign(new Error(`artifact put ${put.status}`), { status: put.status });
  const hash = createHash("sha256").update(zip).digest("hex");
  const finalize = await doFetch(`${base}/FinalizeArtifact`, {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({ ...ids, name, size: String(zip.length), hash: `sha256:${hash}` }),
  });
  if (!finalize.ok) throw Object.assign(new Error(`artifact finalize ${finalize.status}`), { status: finalize.status });
  const finished = await finalize.json();
  if (!finished.ok) throw new Error("artifact finalize was not ok");
  return { name, size: zip.length, artifact_id: finished.artifact_id };
}
