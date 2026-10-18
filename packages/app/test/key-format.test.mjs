// APP-09-AC01: a PKCS#1 key and a PKCS#8 key both import and sign, and the
// signature verifies with the public key. GitHub issues App keys as PKCS#1
// ("BEGIN RSA PRIVATE KEY"); main's pemToPkcs8 strips only a PKCS#8 header
// and threw InvalidCharacterError on one (issue #91, measured with a
// generated key).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mintInstallationToken } from "../src/index.mjs";

const enc = new TextEncoder();

async function generatePair() {
  return crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  );
}

function toPem(der, label) {
  const bytes = new Uint8Array(der);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return `-----BEGIN ${label}-----\n${btoa(bin)}\n-----END ${label}-----`;
}

// The PKCS#8 export's last field is the OCTET STRING holding the PKCS#1 DER:
// a 26-byte prefix (4 SEQUENCE + 3 INTEGER + 15 algorithm + 4 length).
function pkcs1From(pkcs8Der) {
  return new Uint8Array(pkcs8Der).slice(26);
}

// One shared holder: the stub the mint actually calls is whichever test
// installed it last on the global, so the capture must not live in a
// per-test closure.
const captured = { auth: null };

function fakeEnv(t, pem) {
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    captured.auth = init?.headers?.authorization;
    return { ok: true, status: 200, json: async () => ({ token: "tok-1" }) };
  };
  t.after(() => { globalThis.fetch = orig; });
  return { env: { APP_ID: "12345", PRIVATE_KEY: pem } };
}

async function mintAndVerify(t, pair, pem, what) {
  captured.auth = null;
  const { env } = fakeEnv(t, pem);
  const token = await mintInstallationToken(env, 3);
  assert.equal(token, "tok-1", what);
  const auth = captured.auth;
  const jwt = auth.slice(auth.indexOf(" ") + 1);
  const [, input, signed] = jwt.split(".");
  const signature = new Uint8Array(atob(signed.replace(/-/g, "+").replace(/_/g, "/")).split("").map((c) => c.charCodeAt(0)));
  const ok = await crypto.subtle.verify({ name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, pair.publicKey, signature, enc.encode(`${jwt.split(".")[0]}.${input}`));
  assert.equal(ok, true, `${what}: the signature verifies with the public key`);
}

test("a PKCS#8 private key mints a token whose signature verifies", async (t) => {
  const pair = await generatePair();
  const pkcs8 = await crypto.subtle.exportKey("pkcs8", pair.privateKey);
  await mintAndVerify(t, pair, toPem(pkcs8, "PRIVATE KEY"), "PKCS#8");
});

test("a PKCS#1 private key mints a token whose signature verifies", async (t) => {
  const pair = await generatePair();
  const pkcs8 = await crypto.subtle.exportKey("pkcs8", pair.privateKey);
  await mintAndVerify(t, pair, toPem(pkcs1From(pkcs8), "RSA PRIVATE KEY"), "PKCS#1");
});
