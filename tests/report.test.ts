import { test } from "node:test";
import assert from "node:assert/strict";
import { example } from "../src/examples.js";
import { markdown } from "../src/report.js";
test("Markdown preserves unknown types and external program account indexes", async () => {
  const r = (await example("configured"))!;
  const e = r.extra.entries[1]!;
  e.kind = "external-pda";
  e.discriminator = 132;
  e.programIndex = 4;
  const first = markdown(r);
  assert.match(first, /type=132/);
  assert.match(first, /program account #4/);
  e.discriminator = 128;
  e.programIndex = 0;
  assert.notEqual(first, markdown(r));
});
