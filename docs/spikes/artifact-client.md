# Spike: the artifact client (ACT-02, D9)

Question: can a JavaScript action upload one report artifact through the
Actions artifact service with a client written in the file, no @actions
packages, and no write token beyond the job's runtime token?

Method: `packages/action/src/upload.mjs` builds a store-only ZIP in the file
(one file, CRC-32 bitwise, no compression) and makes exactly two calls: the
create call against `ACTIONS_RESULTS_URL` with `ACTIONS_RUNTIME_TOKEN`, then a
PUT of the zip to the returned signed URL. The size cap of 256 KB is checked
before any network call. The spike runs against a recorded fake of both calls
in `packages/action/test/upload.test.mjs`; the live sandbox run on
proved/sandbox records the same two-call shape against the real service.

Result: the client is implemented and unit-tested; the Decision line below is
written after the live sandbox run confirms the two-call shape and the
artifact's appearance on the run page.

Decision: artifact
