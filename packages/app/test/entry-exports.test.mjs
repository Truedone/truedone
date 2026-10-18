// The Workers runtime takes every named export of the Worker's main module for an entry point, and refuses to start
// when one is not a function or a handler: wrangler 3.90's workerd stopped on "Incorrect type for map entry
// 'TOKEN_MARGIN_S': the provided value is not of type 'function or ExportedHandler'" (APP-19's local D1 run,
// 2026-10-18), after APP-17 exported a number from packages/app/src/index.mjs. Every named export there is a function,
// and the default export is the handler object.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as entry from "../src/index.mjs";

test("every named export of the Worker's main module is a function, and the default is the handler object", () => {
  const named = Object.entries(entry).filter(([k]) => k !== "default");
  assert.ok(named.length > 0);
  for (const [name, value] of named) assert.equal(typeof value, "function", `${name} is a ${typeof value}`);
  for (const handler of ["fetch", "queue", "scheduled"]) assert.equal(typeof entry.default[handler], "function", handler);
});
