import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import bs58 from "bs58";
import {
  decodeMint,
  decodeExtraMetas,
  TOKEN,
  TOKEN2022,
} from "../src/decode.js";
const key = (n: number) => Buffer.alloc(32, n);
const mint = () => {
  const b = Buffer.alloc(234);
  b[45] = 1;
  b[44] = 6;
  b[165] = 1;
  b.writeUInt16LE(14, 166);
  b.writeUInt16LE(64, 168);
  key(7).copy(b, 170);
  key(9).copy(b, 202);
  return b;
};
test("decodes Token-2022 hook authority and program from extension bytes", () => {
  const r = decodeMint(mint(), TOKEN2022);
  assert.equal(r.hook.status, "configured");
  assert.equal(r.hook.authority, bs58.encode(key(7)));
  assert.equal(r.hook.programId, bs58.encode(key(9)));
  assert.equal(r.decimals, 6);
});
test("distinguishes absent extension, disabled hook and legacy token mint", () => {
  const plain = Buffer.alloc(82);
  plain[45] = 1;
  assert.equal(decodeMint(plain, TOKEN2022).hook.status, "absent");
  assert.equal(decodeMint(plain, TOKEN).hook.status, "legacy");
  const b = mint();
  b.fill(0, 202);
  assert.equal(decodeMint(b, TOKEN2022).hook.status, "disabled");
  assert.ok(decodeMint(b, TOKEN2022).hook.authority);
});
for (const variant of [
  "short",
  "token-account",
  "truncated",
  "duplicate",
  "bad-option",
  "uninitialized",
  "bad-owner",
  "bad-padding",
])
  test(`rejects malformed mint ${variant}`, () => {
    let b = mint(),
      owner = TOKEN2022;
    if (variant === "short") b = b.subarray(0, 81);
    if (variant === "token-account") b[165] = 2;
    if (variant === "truncated") b = b.subarray(0, 233);
    if (variant === "duplicate") b = Buffer.concat([b, b.subarray(166)]);
    if (variant === "bad-option") b.writeUInt32LE(2, 0);
    if (variant === "uninitialized") b[45] = 0;
    if (variant === "bad-owner") owner = "11111111111111111111111111111111";
    if (variant === "bad-padding") b[100] = 9;
    assert.throws(() => decodeMint(b, owner));
  });
const extra = (entries: Buffer[]) => {
  const v = Buffer.alloc(16);
  createHash("sha256")
    .update("spl-transfer-hook-interface:execute")
    .digest()
    .copy(v, 0, 0, 8);
  v.writeUInt32LE(4 + 35 * entries.length, 8);
  v.writeUInt32LE(entries.length, 12);
  return Buffer.concat([v, ...entries]);
};
test("reads ordered static, hook PDA, external PDA and data-based account configs", () => {
  const entries = [0, 1, 137, 2, 17].map((type, i) => {
    const b = Buffer.alloc(35);
    b[0] = type;
    key(i + 1).copy(b, 1);
    b[33] = i === 0 ? 1 : 0;
    b[34] = 1;
    return b;
  });
  const r = decodeExtraMetas(extra(entries));
  assert.equal(r.length, 5);
  assert.equal(r[0]?.address, bs58.encode(key(1)));
  assert.equal(r[1]?.kind, "hook-pda");
  assert.equal(r[2]?.programIndex, 9);
  assert.equal(r[3]?.kind, "pubkey-data");
  assert.equal(r[4]?.kind, "unknown");
  assert.equal(r[0]?.index, 5);
  assert.equal(r[0]?.signer, true);
});
for (const variant of ["truncated", "count", "boolean", "duplicate", "missing"])
  test(`rejects malformed extra metadata ${variant}`, () => {
    const row = Buffer.alloc(35);
    let b = extra([row]);
    if (variant === "truncated") b = b.subarray(0, b.length - 1);
    if (variant === "count") b.writeUInt32LE(50, 12);
    if (variant === "boolean") b[49] = 2;
    if (variant === "duplicate") b = Buffer.concat([b, b]);
    if (variant === "missing") b = Buffer.alloc(16);
    assert.throws(() => decodeExtraMetas(b));
  });
test("extra metadata rejects partial rows but accepts unused whole-row capacity", () => {
  const bad = extra([]);
  bad.writeUInt32LE(5, 8);
  assert.throws(() =>
    decodeExtraMetas(Buffer.concat([bad, Buffer.from([255])])),
  );
  const capacity = extra([Buffer.alloc(35)]);
  capacity.writeUInt32LE(0, 12);
  assert.deepEqual(decodeExtraMetas(capacity), []);
});
