import { test } from "node:test";
import assert from "node:assert/strict";
import { buildZip, artifactName, uploadReport } from "../src/upload.mjs";

test("the artifact name is truedone-report-<job id>", () => {
  assert.equal(artifactName("build"), "truedone-report-build");
});

test("the zip holds exactly one file with the report contents", () => {
  const zip = buildZip("report.json", '{"schema":"truedone.report/1"}');
  const text = new TextDecoder().decode(zip);
  assert.ok(text.includes("report.json"), "the file name is in the header and central directory");
  assert.ok(text.includes("truedone.report/1"), "the contents are stored verbatim");
  // End-of-central-directory signature present exactly once.
  const sigs = text.split("PK\x05\x06").length - 1;
  assert.equal(sigs, 1);
});

test("a report over the 256 KB cap is refused before any network call", async () => {
  let called = 0;
  const env = { ACTIONS_RUNTIME_TOKEN: "t", ACTIONS_RESULTS_URL: "https://results", fetch: async () => { called++; return { ok: true, json: async () => ({}) }; } };
  await assert.rejects(
    uploadReport(env, { jobId: "j", fileName: "report.json", contents: "x".repeat(256 * 1024 + 1) }),
    /over 256 KB/,
  );
  assert.equal(called, 0, "nothing left the machine");
});

test("the client makes exactly two calls: create with the token, then PUT the zip to the signed url", async () => {
  const calls = [];
  const env = {
    ACTIONS_RUNTIME_TOKEN: "token-1",
    ACTIONS_RESULTS_URL: "https://results.example/",
    fetch: async (url, init = {}) => {
      calls.push({ url: String(url), method: init.method || "GET", headers: init.headers || {}, body: init.body });
      if (String(url).includes("/apis/v1/artifacts")) {
        return { ok: true, json: async () => ({ signedUploadUrl: "https://signed.example/upload" }) };
      }
      return { ok: true };
    },
  };
  const r = await uploadReport(env, { jobId: "j1", fileName: "report.json", contents: "{}" });
  assert.equal(r.name, "truedone-report-j1");
  assert.equal(calls.length, 2);
  assert.equal(calls[0].method, "POST");
  assert.match(calls[0].url, /apis\/v1\/artifacts\?artifactName=truedone-report-j1/);
  assert.equal(calls[0].headers.authorization, "Bearer token-1");
  assert.equal(calls[1].method, "PUT");
  assert.equal(calls[1].url, "https://signed.example/upload");
  assert.equal(calls[1].headers.authorization, "Bearer token-1");
  assert.ok(calls[1].body.length > 0);
});

test("a failed create surfaces the status and stops before the PUT", async () => {
  const calls = [];
  const env = {
    ACTIONS_RUNTIME_TOKEN: "t",
    ACTIONS_RESULTS_URL: "https://results",
    fetch: async (url, init = {}) => { calls.push(String(url)); return { ok: false, status: 403 }; },
  };
  await assert.rejects(uploadReport(env, { jobId: "j", fileName: "report.json", contents: "{}" }), /403/);
  assert.equal(calls.length, 1, "the PUT never ran");
});
