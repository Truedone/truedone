// The report uploader (ACT-02, D9): one artifact per job through the Actions
// artifact service, with the client written in this file and no @actions
// packages. The artifact holds exactly one file, the report, under the cap.

const API_VERSION = "6.0-preview";
const MAX_BYTES = 256 * 1024;

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
  central.set(u16(0), 12);
  central.set(u16(0), 14);
  central.set(u32(crc), 16);
  central.set(u32(data.length), 20);
  central.set(u32(data.length), 24);
  central.set(u16(name.length), 28);
  central.set(u32(0), 42);
  central.set(name, 46);
  const offset = local.length;
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

// The two-call client: create the artifact, then PUT the zip to the signed URL.
// env: { ACTIONS_RUNTIME_TOKEN, ACTIONS_RESULTS_URL }.
export async function uploadReport(env, { jobId, fileName, contents }) {
  const doFetch = env.fetch ?? fetch;
  const name = artifactName(jobId);
  const zip = buildZip(fileName, contents);
  if (zip.length > MAX_BYTES) throw new Error(`report artifact over ${MAX_BYTES / 1024} KB`);
  const create = await doFetch(
    `${env.ACTIONS_RESULTS_URL.replace(/\/$/, "")}/apis/v1/artifacts?artifactName=${encodeURIComponent(name)}&x-ms-api-version=${API_VERSION}`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.ACTIONS_RUNTIME_TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ Type: "actions_storage", Name: name, RunId: env.GITHUB_RUN_ID ? Number(env.GITHUB_RUN_ID) : undefined }),
    },
  );
  if (!create.ok) throw Object.assign(new Error(`artifact create ${create.status}`), { status: create.status });
  const { signedUploadUrl } = await create.json();
  if (!signedUploadUrl) throw new Error("artifact create returned no signed upload url");
  const put = await doFetch(signedUploadUrl, {
    method: "PUT",
    headers: {
      authorization: `Bearer ${env.ACTIONS_RUNTIME_TOKEN}`,
      "content-type": "application/zip",
      "x-tfs-filelength": String(zip.length),
      "x-ms-api-version": API_VERSION,
    },
    body: zip,
  });
  if (!put.ok) throw Object.assign(new Error(`artifact put ${put.status}`), { status: put.status });
  return { name, size: zip.length };
}
