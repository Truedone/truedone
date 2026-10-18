// The Worker's entry (APP-01, DEP-01, APP-08): one fetch handler routes /health
// and /api/github/webhook, which analyses a pull_request delivery after its
// answer, in ctx.waitUntil, with the queue as its retry path (APP-17), and
// queues the rest; the queue handler routes each queued delivery to the
// stage its event belongs to, acknowledging handled messages and retrying
// failures; the scheduled handler runs APP-05's daily sweep over the removed
// installations' leftovers. Only Web APIs.
import { makeHealth } from "./health.mjs";
import { makeIntake, REFUSED_RETRY_DELAY_S, slim } from "./webhook.mjs";
import { makeStatic, makeAnalyser } from "./static.mjs";
import { makeRedGreen } from "./redgreen.mjs";
import { listKeys, sweepLeftovers, tokenKey } from "./posting.mjs";
import { makeGitHub } from "./github.mjs";
import { unzip } from "./unzip.mjs";
import { analyse as coreAnalyse, judge as coreJudge } from "../../core/core.mjs";

const REMOVED_PREFIX = "removed:";
// APP-25 (#125): the dead-letter queues, named in wrangler.toml. A message on one is logged as one line of identifiers
// and acknowledged, so nothing waits there for Cloudflare's four days. Not exported (see TOKEN_MARGIN_S).
const DEAD_LETTER_QUEUES = new Set(["truedone-dev-dlq", "truedone-dlq"]);

export function makeApp(env) {
  const health = makeHealth({ version: env.VERSION ?? "unversioned", flags: env.FLAGS });
  // APP-17: a pull_request delivery is analysed in the intake, with the queue as its retry path
  const intake = makeIntake(env, { run: (body, opts) => runStatic(coreFor(env), body, opts) });
  return async function app(request, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/health") return health(request);
    if (url.pathname === "/api/github/webhook") return intake(request, ctx);
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

// The installation token and its expiry, as GitHub answers them.
export async function mintInstallation(env, installationId) {
  const now = Math.floor(Date.now() / 1000);
  const input = `${b64url(new TextEncoder().encode(JSON.stringify({ alg: "RS256", typ: "JWT" })))}.${b64url(new TextEncoder().encode(JSON.stringify({ iat: now - 60, exp: now + 540, iss: env.APP_ID })))}`;
  const key = await crypto.subtle.importKey("pkcs8", pemToPkcs8(env.PRIVATE_KEY), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(input));
  const r = await fetch(`https://api.github.com/app/installations/${installationId}/access_tokens`, {
    method: "POST",
    headers: { authorization: `Bearer ${input}.${b64url(new Uint8Array(signature))}`, accept: "application/vnd.github+json", "user-agent": "truedone-app" },
  });
  if (!r.ok) throw new Error(`installation token ${r.status}`);
  const { token, expires_at } = await r.json();
  return { token, expires_at };
}

export async function mintInstallationToken(env, installationId) {
  return (await mintInstallation(env, installationId)).token;
}

// APP-17: an installation token is kept in KV until TOKEN_MARGIN_S before GitHub's expires_at, and minted again after
// that; one without an expires_at is not kept. A run that GitHub answers 401 deletes it (dropToken), so the retry
// mints a new one. The token is never logged.
// Not exported: the Workers runtime takes every named export of the main module for an entry point, and refuses to start
// on one that is not a function or a handler (wrangler 3.90's workerd: "Incorrect type for map entry 'TOKEN_MARGIN_S'").
const TOKEN_MARGIN_S = 300;

export async function installationToken(env, installationId, mint = mintInstallation) {
  const kept = env.KV ? await env.KV.get(tokenKey(installationId)) : null;
  if (kept) {
    try {
      const { token, expires_at } = JSON.parse(kept);
      if (token && Date.parse(expires_at) - Date.now() > TOKEN_MARGIN_S * 1000) return token;
    } catch { /* minted again below */ }
  }
  const { token, expires_at } = await mint(env, installationId);
  const ttl = Math.floor((Date.parse(expires_at) - Date.now()) / 1000) - TOKEN_MARGIN_S;
  if (env.KV && ttl >= 60) await env.KV.put(tokenKey(installationId), JSON.stringify({ token, expires_at }), { expirationTtl: ttl });
  return token;
}

export async function dropToken(env, installationId) {
  if (env.KV && installationId !== undefined) await env.KV.delete(tokenKey(installationId));
}

// The static stage for one pull_request delivery, with the kept token; the intake runs it directly (APP-17), with the
// delivery's pull request in memory, so the direct run makes no extra GitHub call (APP-25), and with its dedupe verdict as
// the gate its writes wait for (APP-26).
async function runStatic(env, body, { gate } = {}) {
  const installationId = body.payload?.installation?.id;
  // APP-18: the mint starts beside the stage's config read, not before it; the
  // token is awaited at the first GitHub call. The mint is the App's own
  // credential, not a repository read, so the switch still precedes every
  // repository read and every write (APP-15).
  const tokenP = installationToken(env, installationId);
  try {
    await makeStatic({ ...env, INSTALLATION_TOKEN: tokenP })(body, { pr: body.payload?.pull_request, gate });
  } catch (error) {
    if (error?.status === 401) await dropToken(env, installationId);
    throw error;
  }
}

// The queue and cron handlers. deps override the stages, the mint and the
// sweep so queue.test.mjs can drive the routing with fakes.
export function makeConsumers(deps = {}) {
  const mint = deps.mint ?? ((env, installationId) => installationToken(env, installationId));
  const sweep = deps.sweep ?? sweepLeftovers;
  return {
    async queue(batch, env) {
      if (DEAD_LETTER_QUEUES.has(batch.queue)) {
        for (const message of batch.messages) {
          const { delivery, event } = message.body ?? {};
          console.error(JSON.stringify({ stage: "dead-letter", queue: batch.queue, delivery: String(delivery ?? ""), event: String(event ?? ""), attempts: message.attempts }));
          message.ack();
        }
        return;
      }
      for (const message of batch.messages) {
        let stage = "mint";
        try {
          const { event } = message.body;
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
            await (deps.redGreenStage ?? makeRedGreen(redgreenFor(stageEnv, slim("workflow_run", message.body.payload))))(message.body);
          }
          message.ack();
        } catch (error) {
          // One line per failed delivery (APP-09): the stage, the delivery id
          // and the error, so a dead-letter is seen. Never a secret, token or
          // payload.
          console.error(JSON.stringify({ stage, delivery: message.body?.delivery, error: `${error?.name ?? "Error"}: ${error?.message ?? error}` }));
          // a token GitHub refuses is not kept for the retry, which waits out KV's cache of it (APP-17)
          if (error?.status === 401) {
            await dropToken(env, message.body?.payload?.installation?.id).catch(() => {});
            message.retry({ delaySeconds: REFUSED_RETRY_DELAY_S });
          } else {
            message.retry();
          }
        }
      }
    },
    // Each removed installation is swept on its own (APP-24): a failure logs one line and keeps that marker for the next
    // day's sweep, the rest are still swept, and the run then throws so the cron shows the failure.
    async scheduled(controller, env) {
      const names = await listKeys(env.KV, { prefix: REMOVED_PREFIX });
      const failed = [];
      for (const name of names) {
        const id = Number(String(name).slice(REMOVED_PREFIX.length));
        if (!(Number.isFinite(id) && id > 0)) continue;
        try {
          await sweep(env, id);
        } catch (error) {
          console.error(JSON.stringify({ stage: "sweep", installation: id, error: `${error?.name ?? "Error"}: ${error?.message ?? error}` }));
          failed.push(id);
        }
      }
      if (failed.length > 0) throw new Error(`the sweep failed for ${failed.length} of ${names.length} removed installations`);
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
  fetch(request, env, ctx) {
    return makeApp(env)(request, ctx);
  },
  async queue(batch, env) {
    return makeConsumers().queue(batch, coreFor(env));
  },
  async scheduled(controller, env) {
    return makeConsumers().scheduled(controller, env);
  },
};
