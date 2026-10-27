import {
  address,
  isAddress,
  getAddressEncoder,
  getProgramDerivedAddress,
} from "@solana/addresses";
import { decodeMint, decodeExtraMetas } from "./decode.js";
import { InspectorError } from "./errors.js";
import { createRpcReader, NETWORKS, type Reader } from "./rpc.js";
import type { Inspection } from "./types.js";
export async function inspectMint(
  mint: string,
  network: "mainnet" | "devnet",
  reader: Reader = createRpcReader(NETWORKS[network]),
): Promise<Inspection> {
  if (!isAddress(mint))
    throw new InspectorError(
      "BAD_ADDRESS",
      "Enter a valid Solana token mint address.",
      400,
    );
  const account = await reader.read(mint);
  if (!account)
    throw new InspectorError(
      "ACCOUNT_NOT_FOUND",
      "No account exists at this address on the selected network.",
      404,
    );
  if (account.executable)
    throw new InspectorError(
      "NOT_A_MINT",
      "This is an executable program, not a token mint.",
    );
  let mintInfo;
  try {
    mintInfo = decodeMint(account.data, account.owner);
  } catch (error) {
    throw new InspectorError(
      "INVALID_MINT",
      error instanceof Error
        ? error.message
        : "Mint data could not be decoded.",
    );
  }
  const r: Inspection = {
    version: 1,
    source: "rpc",
    mint,
    network,
    observedAt: new Date().toISOString(),
    slot: account.slot,
    mintInfo,
    program: {
      status: "not-requested",
      executable: null,
      owner: null,
      slot: null,
    },
    extra: { address: null, status: "not-requested", slot: null, entries: [] },
    notes: [
      "Configuration is not a safety verdict. Custom hook behavior is unknown without reviewing its code.",
      "Hook pointer authority and program upgrade authority are different. Program upgrade authority is not inspected.",
      "Other token extensions may impose additional behavior. This tool focuses on TransferHook.",
    ],
  };
  const hook = mintInfo.hook;
  if (!hook.programId) {
    r.notes.push(
      hook.status === "disabled"
        ? "TransferHook exists but its program is unset; it is currently disabled."
        : "No active TransferHook program was found in this mint snapshot.",
    );
    return r;
  }
  if (hook.authority)
    r.notes.push("The hook authority can update the configured hook program.");
  else
    r.notes.push(
      "The hook pointer has no update authority. This does not prove that the program code cannot change.",
    );
  const [extraAddress] = await getProgramDerivedAddress({
    programAddress: address(hook.programId),
    seeds: [
      new TextEncoder().encode("extra-account-metas"),
      getAddressEncoder().encode(address(mint)),
    ],
  });
  r.extra.address = extraAddress;
  try {
    const program = await reader.read(hook.programId, account.slot, true);
    r.program = program
      ? {
          status: "found",
          executable: program.executable,
          owner: program.owner,
          slot: program.slot,
        }
      : { status: "missing", executable: null, owner: null, slot: null };
    if (!program || !program.executable)
      r.notes.push(
        "The configured program is missing or not executable at this observation. A transfer invoking it may fail.",
      );
  } catch {
    r.program.status = "unavailable";
    r.notes.push(
      "Hook program account could not be read. Its executable status remains unverified.",
    );
  }
  try {
    const extra = await reader.read(extraAddress, account.slot);
    if (!extra) {
      r.extra.status = "missing";
      r.notes.push(
        "The optional extra-account PDA is absent. A hook may operate without extra accounts.",
      );
    } else {
      r.extra.slot = extra.slot;
      if (extra.owner !== hook.programId || extra.executable)
        throw new Error("owner");
      r.extra.entries = decodeExtraMetas(extra.data);
      r.extra.status = "found";
      if (r.extra.entries.some((e) => e.kind !== "static"))
        r.notes.push(
          "Dynamic account configurations are shown as raw bytes. Resolving them needs transfer-specific accounts or instruction data.",
        );
      if (r.extra.entries.some((e) => e.kind === "unknown"))
        r.notes.push(
          "An unknown extra-account format is present. Its meaning is not inferred.",
        );
    }
  } catch {
    r.extra.status = "unavailable";
    r.notes.push(
      "Extra-account configuration could not be read or validated. Do not interpret this as zero required accounts.",
    );
  }
  r.notes.push(
    "Accounts are read separately at confirmed commitment with a minimum mint context slot. This is not an atomic snapshot.",
  );
  return r;
}
