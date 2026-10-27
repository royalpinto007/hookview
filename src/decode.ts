import bs58 from "bs58";
import { createHash } from "node:crypto";
import type { Mint, ExtraMeta } from "./types.js";
export const TOKEN = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
export const TOKEN2022 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const nonzero = (b: Buffer) => b.some((v) => v !== 0);
export function decodeMint(data: Buffer, owner: string): Mint {
  if (owner !== TOKEN && owner !== TOKEN2022)
    throw new Error("Account is not owned by Token or Token-2022.");
  if (
    data.length < 82 ||
    data[45] !== 1 ||
    ![0, 1].includes(data.readUInt32LE(0)) ||
    ![0, 1].includes(data.readUInt32LE(46))
  )
    throw new Error("Account is not an initialized token mint.");
  const r: Mint = {
    decimals: data[44]!,
    supplyRaw: data.readBigUInt64LE(36).toString(),
    extensions: [],
    hook: {
      status: owner === TOKEN ? "legacy" : "absent",
      authority: null,
      programId: null,
    },
  };
  if (owner === TOKEN) {
    if (data.length !== 82) throw new Error("Invalid legacy mint size.");
    return r;
  }
  if (data.length === 82) return r;
  if (
    data.length < 166 ||
    data.length === 355 ||
    data[165] !== 1 ||
    nonzero(data.subarray(82, 165))
  )
    throw new Error("Invalid Token-2022 mint extension header.");
  let offset = 166;
  while (offset < data.length) {
    if (!nonzero(data.subarray(offset))) break;
    if (offset + 4 > data.length)
      throw new Error("Truncated mint extension header.");
    const type = data.readUInt16LE(offset),
      length = data.readUInt16LE(offset + 2);
    offset += 4;
    if (
      type === 0 ||
      offset + length > data.length ||
      r.extensions.includes(type)
    )
      throw new Error("Malformed or duplicate mint extension.");
    r.extensions.push(type);
    if (type === 14) {
      if (length !== 64)
        throw new Error("Invalid TransferHook extension size.");
      const authority = data.subarray(offset, offset + 32),
        program = data.subarray(offset + 32, offset + 64);
      r.hook = {
        status: nonzero(program) ? "configured" : "disabled",
        authority: nonzero(authority) ? bs58.encode(authority) : null,
        programId: nonzero(program) ? bs58.encode(program) : null,
      };
    }
    offset += length;
  }
  return r;
}
const execute = createHash("sha256")
  .update("spl-transfer-hook-interface:execute")
  .digest()
  .subarray(0, 8);
export function decodeExtraMetas(data: Buffer): ExtraMeta[] {
  let offset = 0,
    entries: ExtraMeta[] | undefined;
  while (offset < data.length) {
    if (!nonzero(data.subarray(offset))) break;
    if (offset + 12 > data.length)
      throw new Error("Truncated metadata TLV header.");
    const discriminator = data.subarray(offset, offset + 8),
      length = data.readUInt32LE(offset + 8);
    offset += 12;
    if (offset + length > data.length)
      throw new Error("Truncated metadata TLV value.");
    if (discriminator.equals(execute)) {
      if (entries || length < 4 || (length - 4) % 35 !== 0)
        throw new Error("Invalid or duplicate Execute metadata.");
      const count = data.readUInt32LE(offset);
      if (count > 256 || 4 + 35 * count > length)
        throw new Error(
          "Metadata count exceeds the data or the inspection limit (256).",
        );
      entries = [];
      for (let i = 0; i < count; i++) {
        const start = offset + 4 + i * 35,
          type = data[start]!,
          config = data.subarray(start + 1, start + 33),
          signer = data[start + 33]!,
          writable = data[start + 34]!;
        if (signer > 1 || writable > 1)
          throw new Error("Invalid metadata boolean.");
        entries.push({
          index: i + 5,
          kind:
            type === 0
              ? "static"
              : type === 1
                ? "hook-pda"
                : type === 2
                  ? "pubkey-data"
                  : type >= 128
                    ? "external-pda"
                    : "unknown",
          discriminator: type,
          address: type === 0 ? bs58.encode(config) : null,
          programIndex: type >= 128 ? type - 128 : null,
          configHex: config.toString("hex"),
          signer: signer === 1,
          writable: writable === 1,
        });
      }
    }
    offset += length;
  }
  if (!entries)
    throw new Error("No Execute extra-account configuration was found.");
  return entries;
}
