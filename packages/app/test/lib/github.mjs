// APP-13: a fetch that answers as GitHub does. api.github.com answers from exact "METHOD /path" routes (the query
// string ignored), raw.githubusercontent.com only for the "owner/repo/ref/path" files it holds, and anything else is a
// 404, so a wrong field, ref or path reads as missing rather than as an empty success. Every call is recorded with its
// method, URL, headers and body. The recorded mgillr/truedone-sandbox#42 answers (2026-10-18, read from GitHub without
// a token; the pull request trimmed to the fields a webhook delivery carries and the stage reads) live in
// fixtures/sandbox-42.
import fs from "node:fs";

export function fakeGitHub({ api = {}, raw = {} } = {}) {
  const calls = [];
  async function fetch(url, init = {}) {
    const u = String(url);
    const method = init.method || "GET";
    calls.push({ url: u, method, headers: { ...(init.headers || {}) }, body: init.body });
    if (u.startsWith("https://raw.githubusercontent.com/")) {
      const key = decodeURIComponent(u.slice("https://raw.githubusercontent.com/".length));
      return key in raw ? new Response(raw[key]) : new Response("404: Not Found", { status: 404 });
    }
    if (!u.startsWith("https://api.github.com/")) return new Response("not found", { status: 404 });
    const route = `${method} ${u.slice("https://api.github.com".length).replace(/\?.*$/, "")}`;
    if (!(route in api)) return Response.json({ message: "Not Found" }, { status: 404 });
    const body = api[route];
    return typeof body === "function" ? body(u, init) : Response.json(body, { status: method === "POST" ? 201 : 200 });
  }
  fetch.calls = calls;
  return fetch;
}

export function memoryKV() {
  const store = new Map();
  return {
    async get(k) { return store.has(k) ? store.get(k) : null; },
    async put(k, v) { store.set(k, v); },
    async delete(k) { store.delete(k); },
    async list() { return { keys: [], list_complete: true, cursor: undefined }; },
  };
}

// The routes the static stage writes to for pull request n of owner/repo at head, with no check run or label yet.
export function writeRoutes(owner, repo, n, head) {
  const r = `/repos/${owner}/${repo}`;
  return {
    [`GET ${r}/commits/${head}/check-runs`]: { total_count: 0, check_runs: [] },
    [`POST ${r}/check-runs`]: { id: 1 },
    [`GET ${r}/issues/${n}/labels`]: [],
    [`GET ${r}/labels`]: [],
    [`POST ${r}/labels`]: {},
    [`POST ${r}/issues/${n}/labels`]: [],
  };
}

// A pull_request delivery as the queue carries it: the event, the delivery id and GitHub's payload.
export function delivery(pull, installation = 3) {
  const repo = pull.base.repo;
  return {
    event: "pull_request",
    delivery: `d-${pull.number}`,
    payload: {
      action: "synchronize",
      number: pull.number,
      pull_request: pull,
      repository: { id: repo.id, name: repo.name, owner: { login: repo.owner.login } },
      installation: { id: installation },
    },
  };
}

// The calls the stage made of one kind.
export const checkRuns = (fetch) => fetch.calls.filter((c) => c.method === "POST" && /\/check-runs$/.test(c.url));
export const labelWrites = (fetch, n) => fetch.calls.filter((c) => c.method === "POST" && new RegExp(`/issues/${n}/labels$`).test(c.url));
export const rawCalls = (fetch) => fetch.calls.filter((c) => c.url.startsWith("https://raw.githubusercontent.com/")).map((c) => c.url.slice("https://raw.githubusercontent.com/".length));

const FIX = new URL("../fixtures/sandbox-42/", import.meta.url);
export function sandbox42() {
  const pull = JSON.parse(fs.readFileSync(new URL("pull.json", FIX), "utf8"));
  const files = JSON.parse(fs.readFileSync(new URL("files.json", FIX), "utf8"));
  const at = (sha) => `${pull.base.repo.full_name}/${sha}/python/tests/test_calc.py`;
  const raw = {
    [at(pull.base.sha)]: fs.readFileSync(new URL("base-test_calc.py", FIX), "utf8"),
    [at(pull.head.sha)]: fs.readFileSync(new URL("head-test_calc.py", FIX), "utf8"),
  };
  const [owner, repo] = pull.base.repo.full_name.split("/");
  const api = {
    [`GET /repos/${owner}/${repo}/pulls/42/files`]: files,
    ...writeRoutes(owner, repo, 42, pull.head.sha),
  };
  return { pull, files, raw, api, owner, repo };
}

// A 2048-bit RSA key in PKCS#1 PEM, the format GitHub issues App keys in (APP-09).
export async function pkcs1Pem() {
  const pair = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign"],
  );
  const der = new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey)).slice(26);
  let bin = "";
  for (const b of der) bin += String.fromCharCode(b);
  return `-----BEGIN RSA PRIVATE KEY-----\n${btoa(bin)}\n-----END RSA PRIVATE KEY-----`;
}

// A stored zip (method 0) holding one entry, the shape a report artifact arrives in.
export function storedZip(text, name = "r") {
  const data = new TextEncoder().encode(text);
  const nm = new TextEncoder().encode(name);
  const local = new Uint8Array(30 + nm.length + data.length);
  const lv = new DataView(local.buffer);
  lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true); lv.setUint16(8, 0, true);
  lv.setUint32(18, data.length, true); lv.setUint32(22, data.length, true); lv.setUint16(26, nm.length, true);
  local.set(nm, 30); local.set(data, 30 + nm.length);
  const central = new Uint8Array(46 + nm.length);
  const cv = new DataView(central.buffer);
  cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true);
  cv.setUint32(20, data.length, true); cv.setUint32(24, data.length, true); cv.setUint16(28, nm.length, true);
  central.set(nm, 46);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, 1, true); ev.setUint16(10, 1, true);
  ev.setUint32(12, central.length, true); ev.setUint32(16, local.length, true);
  const out = new Uint8Array(local.length + central.length + 22);
  out.set(local, 0); out.set(central, local.length); out.set(eocd, local.length + central.length);
  return out;
}
