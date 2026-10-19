// The uploader's tests use fakes in the real v4 answers' shape: CreateArtifact
// answers ok and signed_upload_url, the zip PUTs to the signed url as a block
// blob with no Authorization header, FinalizeArtifact answers ok and
// artifact_id with the size as a string and the sha256 hash.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildZip, artifactName, backendIdsFromToken, uploadReport } from "../src/upload.mjs";

const B64URL = (s) => Buffer.from(s).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const RUNTIME_TOKEN = `${B64URL('{"alg":"RS256"}')}.${B64URL('{"scp":"Actions.Results:run-1:job-2"}')}.sig`;

test("the artifact name is truedone-report-<job id>", () => {
  assert.equal(artifactName("build"), "truedone-report-build");
});

test("the backend ids come from the runtime token's Actions.Results scope", () => {
  assert.deepEqual(backendIdsFromToken(RUNTIME_TOKEN), { workflow_run_backend_id: "run-1", workflow_job_run_backend_id: "job-2" });
  assert.throws(() => backendIdsFromToken(`${B64URL('{"alg":"RS256"}')}.${B64URL('{"scp":"Actions.ExampleScope"}')}.sig`), /no Actions.Results scope/);
  assert.throws(() => backendIdsFromToken("not-a-jwt"), /no JWT payload/);
});

test("the zip holds exactly one file with the report contents", () => {
  const zip = buildZip("report.json", '{"schema":"truedone.report/1"}');
  const text = new TextDecoder().decode(zip);
  assert.ok(text.includes("report.json"), "the file name is in the header and central directory");
  assert.ok(text.includes("truedone.report/1"), "the contents are stored verbatim");
  const sigs = text.split("PK\x05\x06").length - 1;
  assert.equal(sigs, 1);
  // #160: the end record's central-directory offset must point at the real
  // central directory, after the local header, its name and the data.
  const dataBytes = new TextEncoder().encode('{"schema":"truedone.report/1"}');
  const centralAt = 30 + "report.json".length + dataBytes.length;
  const endRecord = text.lastIndexOf("PK\x05\x06");
  assert.equal(text.charCodeAt(endRecord + 16) | (text.charCodeAt(endRecord + 17) << 8) | (text.charCodeAt(endRecord + 18) << 16) | (text.charCodeAt(endRecord + 19) << 24), centralAt, "the central-directory offset points into the data");
  assert.equal(text.slice(centralAt, centralAt + 4), "PK\x01\x02", "the central directory is where the offset says");
});

test("a report over the 256 KB cap is refused before any network call", async () => {
  let called = 0;
  const env = { ACTIONS_RUNTIME_TOKEN: RUNTIME_TOKEN, ACTIONS_RESULTS_URL: "https://results", fetch: async () => { called++; return { ok: true, json: async () => ({}) }; } };
  await assert.rejects(
    uploadReport(env, { jobId: "j", fileName: "report.json", contents: "x".repeat(256 * 1024 + 1) }),
    /over 256 KB/,
  );
  assert.equal(called, 0, "nothing left the machine");
});

test("the client makes exactly three calls: CreateArtifact, the block-blob PUT with no authorization, FinalizeArtifact", async () => {
  const calls = [];
  const env = {
    ACTIONS_RUNTIME_TOKEN: RUNTIME_TOKEN,
    ACTIONS_RESULTS_URL: "https://results.example/",
    fetch: async (url, init = {}) => {
      calls.push({ url: String(url), method: init.method || "GET", headers: init.headers || {}, body: init.body });
      const u = String(url);
      if (u.endsWith("/CreateArtifact")) return { ok: true, json: async () => ({ ok: true, signed_upload_url: "https://signed.example/upload" }) };
      if (u.endsWith("/FinalizeArtifact")) return { ok: true, json: async () => ({ ok: true, artifact_id: 42 }) };
      return { ok: true, status: 201 };
    },
  };
  const contents = "{}";
  const r = await uploadReport(env, { jobId: "j1", fileName: "report.json", contents });
  assert.equal(r.name, "truedone-report-j1");
  assert.equal(r.artifact_id, 42);
  assert.equal(calls.length, 3);
  assert.match(calls[0].url, /\/twirp\/github\.actions\.results\.api\.v1\.ArtifactService\/CreateArtifact$/);
  assert.equal(calls[0].headers.authorization, `Bearer ${RUNTIME_TOKEN}`);
  assert.equal(calls[0].headers["content-type"], "application/json");
  const createBody = JSON.parse(calls[0].body);
  assert.deepEqual(createBody, { workflow_run_backend_id: "run-1", workflow_job_run_backend_id: "job-2", name: "truedone-report-j1", version: 4 });
  assert.equal(calls[1].method, "PUT");
  assert.equal(calls[1].url, "https://signed.example/upload");
  assert.equal(calls[1].headers["x-ms-blob-type"], "BlockBlob");
  assert.equal(calls[1].headers.authorization, undefined, "the signed url takes no Authorization header");
  const zip = buildZip("report.json", contents);
  assert.equal(calls[1].body.length, zip.length);
  assert.match(calls[2].url, /\/FinalizeArtifact$/);
  const finalizeBody = JSON.parse(calls[2].body);
  assert.equal(finalizeBody.size, String(zip.length), "the size travels as a string");
  assert.match(finalizeBody.hash, /^sha256:[0-9a-f]{64}$/);
  assert.equal(finalizeBody.workflow_run_backend_id, "run-1");
  assert.equal(finalizeBody.workflow_job_run_backend_id, "job-2");
});

test("a failed create surfaces the status and stops before the PUT", async () => {
  const calls = [];
  const env = {
    ACTIONS_RUNTIME_TOKEN: RUNTIME_TOKEN,
    ACTIONS_RESULTS_URL: "https://results",
    fetch: async (url, init = {}) => { calls.push(String(url)); return { ok: false, status: 404 }; },
  };
  await assert.rejects(uploadReport(env, { jobId: "j", fileName: "report.json", contents: "{}" }), /404/);
  assert.equal(calls.length, 1, "the PUT never ran");
});

test("a create answer that is not ok stops before the PUT", async () => {
  const calls = [];
  const env = {
    ACTIONS_RUNTIME_TOKEN: RUNTIME_TOKEN,
    ACTIONS_RESULTS_URL: "https://results",
    fetch: async (url, init = {}) => {
      calls.push(String(url));
      return { ok: true, json: async () => ({ ok: false }) };
    },
  };
  await assert.rejects(uploadReport(env, { jobId: "j", fileName: "report.json", contents: "{}" }), /artifact create was not ok/);
  assert.equal(calls.length, 1, "the PUT never ran");
});
