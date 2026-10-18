// The Worker's entry (APP-01, DEP-01, APP-08): one fetch handler routes /health
// and /api/github/webhook; the queue handler routes each queued delivery to the
// stage its event belongs to, acknowledging handled messages and retrying
// failures; the scheduled handler runs APP-05's daily sweep over the removed
// installations' leftovers. Only Web APIs.
import { makeHealth } from "./health.mjs";
import { makeIntake } from "./webhook.mjs";
import { makeStatic, makeAnalyser } from "./static.mjs";
import { makeRedGreen } from "./redgreen.mjs";
import { listKeys, sweepLeftovers } from "./posting.mjs";
import { makeGitHub } from "./github.mjs";
import { unzip } from "./unzip.mjs";
import { analyse as coreAnalyse, judge as coreJudge } from "../../core/core.mjs";

const REMOVED_PREFIX = "removed:";

export function makeApp(env) {
  const health = makeHealth({ version: env.VERSION ?? "unversioned", kv: env.KV });
  const intake = makeIntake(env);
  return async function app(request) {
    const url = new URL(request.url);
    if (url.pathname === "/health") return health(request);
    if (url.pathname === "/api/github/webhook") return intake(request);
    return new Response("not found", { status: 404 });
  };
}

// The stages call GitHub with an installation token minted per delivery from
// the app's private key (S5: the key exists only as a Worker secret).
// GitHub issues App keys as PKCS#1 ("BEGIN RSA PRIVATE KEY"; APP-09, issue
// #91): a PKCS#1 DER is wrapped in the PKCS#8 PrivateKeyInfo header for
// rsaEncryption, 26 bytes, so Web Crypto's "pkcs8" import accepts it; a
// PKCS#8 key is taken as today. Keys under 64 KiB of DER fit the two-byte
// lengths (GitHub's 2048-bit keys are ~1.2 KiB).
function pemToPkcs8(pem) {
  const text = String(pem);
  const pkcs1 = text.includes("BEGIN RSA PRIVATE KEY");
  const b64 = text
    .replace(pkcs1 ? /-----BEGIN RSA PRIVATE KEY-----/ : /-----BEGIN PRIVATE KEY-----/, "")
    .replace(pkcs1 ? /-----END RSA PRIVATE KEY-----/ : /-----END PRIVATE KEY-----/, "")
    .replace(/\s+/g, "");
  const raw = atob(b64);
  const der = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) der[i] = raw.charCodeAt(i);
  if (!pkcs1) return der.buffer;
  const out = new Uint8Array(26 + der.length);
  out.set([0x30, 0x82, (der.length + 22) >> 8, (der.length + 22) & 0xff,
    0x02, 0x01, 0x00,
    0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00,
    0x04, 0x82, der.length >> 8, der.length & 0xff]);
  out.set(der, 26);
  return out.buffer;
}

function b64url(bytes) {
  let out = "";
  for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(out).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

export async function mintInstallationToken(env, installationId) {
  const now = Math.floor(Date.now() / 1000);
  const input = `${b64url(new TextEncoder().encode(JSON.stringify({ alg: "RS256", typ: "JWT" })))}.${b64url(new TextEncoder().encode(JSON.stringify({ iat: now - 60, exp: now + 540, iss: env.APP_ID })))}`;
  const key = await crypto.subtle.importKey("pkcs8", pemToPkcs8(env.PRIVATE_KEY), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(input));
  const r = await fetch(`https://api.github.com/app/installations/${installationId}/access_tokens`, {
    method: "POST",
    headers: { authorization: `Bearer ${input}.${b64url(new Uint8Array(signature))}`, accept: "application/vnd.github+json", "user-agent": "truedone-app" },
  });
  if (!r.ok) throw new Error(`installation token ${r.status}`);
  return (await r.json()).token;
}

// The queue and cron handlers. deps override the stages, the mint and the
// sweep so queue.test.mjs can drive the routing with fakes.
export function makeConsumers(deps = {}) {
  const mint = deps.mint ?? mintInstallationToken;
  const sweep = deps.sweep ?? sweepLeftovers;
  return {
    async queue(batch, env) {
      for (const message of batch.messages) {
        let stage = "mint";
        try {
          const { event, delivery } = message.body;
          const installationId = message.body.payload?.installation?.id;
          const token = await mint(env, installationId);
          const stageEnv = { ...env, INSTALLATION_TOKEN: token };
          stage = event === "workflow_run" ? "red-green" : "static";
          // The stage gets the whole message body ({event, delivery, payload};
          // APP-10): the handlers read delivery.payload, and the bare id
          // string reaching them failed every real delivery.
          if (event === "pull_request") {
            await (deps.staticStage ?? makeStatic(stageEnv))(message.body);
          } else if (event === "workflow_run") {
            await (deps.redGreenStage ?? makeRedGreen(redgreenFor(stageEnv, message.body.payload)))(message.body);
          }
          message.ack();
        } catch (error) {
          // One line per failed delivery (APP-09): the stage, the delivery id
          // and the error, so a dead-letter is seen. Never a secret, token or
          // payload.
          console.error(JSON.stringify({ stage, delivery: message.body?.delivery, error: `${error?.name ?? "Error"}: ${error?.message ?? error}` }));
          message.retry();
        }
      }
    },
    async scheduled(controller, env) {
      const names = await listKeys(env.KV, { prefix: REMOVED_PREFIX });
      for (const name of names) {
        const id = Number(String(name).slice(REMOVED_PREFIX.length));
        if (Number.isFinite(id) && id > 0) await sweep(env, id);
      }
    },
  };
}

// APP-11: the core engine, handed to the stages as-is.
function coreFor(env) {
  env.core ??= { analyse: coreAnalyse, judge: coreJudge };
  return env;
}

// APP-12: the red-green stage's eight, built from real code against the
// payload's repository. postCheck, postLabel, publishedShas and the fetch
// layer are the same calls the static stage uses, shared rather than copied;
// staticResult and staticVerdict run the shared static analysis for the head
// commit and cache it; defaultStepSha reads the default branch's workflow;
// UNZIP inflates with Web APIs.
function redgreenFor(env, payload) {
  if (env.UNZIP) return env;
  const gh = makeGitHub(env);
  const analyse = makeAnalyser(env, gh);
  const owner = payload.repository.owner.login;
  const repo = payload.repository.name;
  const cache = new Map();
  const staticResult = async (sha) => {
    if (cache.has(sha)) return cache.get(sha);
    const prs = await gh.api(`/repos/${owner}/${repo}/commits/${sha}/pulls`);
    const pr = prs[0];
    // APP-13: the analyser reads the pull request's files itself, with the site's
    // reader, at this commit.
    const result = await analyse(env, owner, repo, pr && { ...pr, head: { ...pr.head, sha } });
    cache.set(sha, result);
    return result;
  };
  const defaultStepSha = async () => {
    const info = await gh.api(`/repos/${owner}/${repo}`);
    const ref = info.default_branch;
    const listing = await gh.api(`/repos/${owner}/${repo}/contents/.github/workflows?ref=${encodeURIComponent(ref)}`);
    for (const f of listing) {
      const text = await gh.rawFile(owner, repo, ref, `.github/workflows/${f.name}`).catch(() => undefined);
      const found = text?.match(/uses:\s*\S*truedone-action\S*@([0-9a-f]{40})/)?.[1];
      if (found) return found;
    }
    return null;
  };
  return Object.assign(env, {
    UNZIP: unzip,
    defaultStepSha,
    publishedShas: gh.publishedShas,
    // The stage's own call shapes (sha, judged, meta) and (number, judged),
    // adapted onto the shared five-argument GitHub calls.
    postCheck: (sha, judged, meta) => gh.postCheck(meta.owner, meta.repo, sha, judged, meta),
    postLabel: (number, judged) => gh.postLabel(owner, repo, number, judged, { owner, repo, number }),
    staticResult,
    staticVerdict: async (sha) => (await staticResult(sha))?.verdict,
  });
}

export default {
  fetch(request, env) {
    return makeApp(env)(request);
  },
  async queue(batch, env) {
    return makeConsumers().queue(batch, coreFor(env));
  },
  async scheduled(controller, env) {
    return makeConsumers().scheduled(controller, env);
  },
};
