// APP-09-AC03: the sweep iterates the keys KV.list returns, across its cursor.
// Real KV lists return { keys, list_complete, cursor }; main iterated the
// result object itself, so a paged list swept nothing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeConsumers } from "../src/index.mjs";
import { deleteInstallationData } from "../src/posting.mjs";
import { flagsDB } from "./lib/github.mjs";

// Two pages for the removed: prefix, like a real paged KV.list.
function pagedKV(pages) {
  const store = new Map();
  let page = 0;
  return {
    store,
    listCalls: [],
    async get(k) { return store.get(k) ?? null; },
    async put(k, v) { store.set(k, v); },
    async delete(k) { store.delete(k); },
    async list(opts = {}) {
      this.listCalls.push({ ...opts });
      const p = pages[page];
      page += 1;
      return { keys: [...p.keys], list_complete: p.list_complete, cursor: p.cursor };
    },
  };
}

test("the scheduled sweep follows the cursor and sweeps every listed installation", async () => {
  const kv = pagedKV([
    { keys: ["removed:11", "removed:12"], list_complete: false, cursor: "c-1" },
    { keys: ["removed:13"], list_complete: true },
  ]);
  for (const k of ["removed:11", "removed:12", "removed:13"]) await kv.put(k, "1");
  const swept = [];
  const consumers = makeConsumers({ sweep: async (env, id) => { swept.push(id); } });
  await consumers.scheduled({}, { KV: kv, FLAGS: flagsDB() });
  assert.deepEqual(swept.sort(), [11, 12, 13]);
  assert.equal(kv.listCalls.length, 2, "both pages were fetched");
  assert.equal(kv.listCalls[0].cursor, undefined, "the first page carries no cursor");
  assert.equal(kv.listCalls[1].cursor, "c-1", "the second page follows the first's cursor");
});

test("uninstall's deleteInstallationData deletes keys across pages", async () => {
  const kv = pagedKV([
    { keys: ["11:a", "11:b"], list_complete: false, cursor: "c-2" },
    { keys: ["11:c"], list_complete: true },
  ]);
  for (const k of ["11:a", "11:b", "11:c"]) await kv.put(k, "1");
  const removed = await deleteInstallationData({ KV: kv, FLAGS: flagsDB() }, 11);
  assert.equal(removed, 3, "every key across both pages is counted");
  assert.equal(kv.store.size, 0, "every key across both pages is deleted");
  assert.equal(kv.listCalls.length, 2, "both pages were fetched");
});
