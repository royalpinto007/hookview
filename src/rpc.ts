import { z } from "zod";
import { isAddress } from "@solana/addresses";
import { InspectorError } from "./errors.js";
import type { Account } from "./types.js";
export const NETWORKS = {
  mainnet: "https://api.mainnet-beta.solana.com",
  devnet: "https://api.devnet.solana.com",
};
export interface Reader {
  read(
    address: string,
    minSlot?: number,
    programOnly?: boolean,
  ): Promise<Account | null>;
}
const envelope = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.literal(1),
  result: z.object({
    context: z.object({ slot: z.number().int().nonnegative().safe() }),
    value: z
      .object({
        owner: z.string().refine(isAddress),
        executable: z.boolean(),
        data: z.tuple([z.string().max(1_500_000), z.literal("base64")]),
      })
      .nullable(),
  }),
});
export function createRpcReader(endpoint: string, timeoutMs = 10000): Reader {
  return {
    async read(address, minSlot = 0, programOnly = false) {
      const abort = new AbortController(),
        timer = setTimeout(() => abort.abort(), timeoutMs);
      let response: Response | undefined;
      try {
        response = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "getAccountInfo",
            params: [
              address,
              {
                encoding: "base64",
                commitment: "confirmed",
                ...(minSlot ? { minContextSlot: minSlot } : {}),
                ...(programOnly ? { dataSlice: { offset: 0, length: 0 } } : {}),
              },
            ],
          }),
          signal: abort.signal,
          redirect: "error",
        });
        if (response.status === 429)
          throw new InspectorError(
            "RPC_RATE_LIMIT",
            "Public RPC rate limit reached. Wait a moment and retry.",
            429,
          );
        if (!response.ok)
          throw new InspectorError(
            "RPC_UNAVAILABLE",
            "Public RPC is unavailable. Try again later.",
            502,
          );
        if (!response.body) throw new Error("empty");
        const reader = response.body.getReader();
        let size = 0;
        const chunks: Uint8Array[] = [];
        try {
          while (true) {
            const part = await reader.read();
            if (part.done) break;
            size += part.value.byteLength;
            if (size > 2_000_000)
              throw new InspectorError(
                "RPC_INVALID_RESPONSE",
                "RPC response exceeded the inspection limit.",
                502,
              );
            chunks.push(part.value);
          }
        } finally {
          await reader.cancel().catch(() => {});
        }
        let value: unknown;
        try {
          value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        } catch {
          throw new InspectorError(
            "RPC_INVALID_RESPONSE",
            "RPC returned malformed JSON.",
            502,
          );
        }
        if (typeof value === "object" && value !== null && "error" in value)
          throw new InspectorError(
            "RPC_ERROR",
            "RPC could not complete the account read. Retry or switch networks.",
            502,
          );
        const parsed = envelope.safeParse(value);
        if (!parsed.success)
          throw new InspectorError(
            "RPC_INVALID_RESPONSE",
            "RPC returned an unexpected account response.",
            502,
          );
        const { context, value: account } = parsed.data.result;
        if (context.slot < minSlot)
          throw new InspectorError(
            "RPC_INVALID_RESPONSE",
            "RPC returned a context older than the mint observation.",
            502,
          );
        if (account === null) return null;
        const encoded = account.data[0],
          data = Buffer.from(encoded, "base64");
        if (data.toString("base64") !== encoded)
          throw new InspectorError(
            "RPC_INVALID_RESPONSE",
            "RPC returned invalid base64 account data.",
            502,
          );
        return {
          owner: account.owner,
          executable: account.executable,
          data,
          slot: context.slot,
        };
      } catch (error) {
        if (error instanceof InspectorError) throw error;
        if (abort.signal.aborted)
          throw new InspectorError(
            "RPC_TIMEOUT",
            "Public RPC timed out. Try again.",
            504,
          );
        throw new InspectorError(
          "RPC_UNAVAILABLE",
          "Could not reach public RPC. Check your connection and try again.",
          502,
        );
      } finally {
        clearTimeout(timer);
        if (response?.body && !response.body.locked)
          await response.body.cancel().catch(() => {});
      }
    },
  };
}
