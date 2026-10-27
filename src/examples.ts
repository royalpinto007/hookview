import bs58 from "bs58";
import { createHash } from "node:crypto";
import { decodeMint, TOKEN, TOKEN2022 } from "./decode.js";
import { inspectMint } from "./inspect.js";
import type { Account } from "./types.js";
export const EXAMPLES = [
  { id: "configured", name: "Configured hook" },
  { id: "disabled", name: "Disabled hook" },
  { id: "plain", name: "No hook extension" },
  { id: "legacy", name: "Legacy mint" },
];
export async function example(id: string) {
  if (!EXAMPLES.some((e) => e.id === id)) return undefined;
  const key = (n: number) => Buffer.alloc(32, n),
    mint = bs58.encode(key(6)),
    program = bs58.encode(key(9));
  const bytes = Buffer.alloc(
    id === "configured" || id === "disabled" ? 234 : 82,
  );
  bytes[44] = 6;
  bytes[45] = 1;
  bytes.writeBigUInt64LE(1_000_000_000n, 36);
  if (bytes.length > 82) {
    bytes[165] = 1;
    bytes.writeUInt16LE(14, 166);
    bytes.writeUInt16LE(64, 168);
    key(7).copy(bytes, 170);
    if (id === "configured") key(9).copy(bytes, 202);
  }
  const info = decodeMint(bytes, id === "legacy" ? TOKEN : TOKEN2022);
  const header = Buffer.alloc(16);
  createHash("sha256")
    .update("spl-transfer-hook-interface:execute")
    .digest()
    .copy(header, 0, 0, 8);
  header.writeUInt32LE(4 + 70, 8);
  header.writeUInt32LE(2, 12);
  const staticRow = Buffer.alloc(35);
  key(8).copy(staticRow, 1);
  staticRow[34] = 1;
  const dynamicRow = Buffer.alloc(35);
  dynamicRow[0] = 1;
  dynamicRow[1] = 1;
  dynamicRow[2] = 7;
  Buffer.from("counter").copy(dynamicRow, 3);
  dynamicRow[10] = 3;
  dynamicRow[11] = 3;
  dynamicRow[34] = 1;
  const report = await inspectMint(mint, "devnet", {
    async read(address) {
      if (address === mint)
        return {
          owner: id === "legacy" ? TOKEN : TOKEN2022,
          executable: false,
          data: bytes,
          slot: 0,
        };
      if (address === program)
        return {
          owner: "BPFLoaderUpgradeab1e11111111111111111111111",
          executable: true,
          data: Buffer.alloc(0),
          slot: 0,
        };
      return {
        owner: program,
        executable: false,
        data: Buffer.concat([header, staticRow, dynamicRow]),
        slot: 0,
      } as Account;
    },
  });
  report.source = "example";
  report.exampleName = EXAMPLES.find((e) => e.id === id)!.name;
  report.observedAt = "2026-10-27T00:00:00.000Z";
  report.mintInfo = info;
  report.notes.unshift(
    "Fictional fixture. These addresses, account states and slots are not a live chain observation.",
  );
  return report;
}
