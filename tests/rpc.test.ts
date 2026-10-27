import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { createRpcReader } from "../src/rpc.js";
import { inspectMint } from "../src/inspect.js";
const mint = "So11111111111111111111111111111111111111112";
async function fixture(
  reply: (body: Record<string, unknown>) => unknown,
  run: (endpoint: string) => Promise<void>,
) {
  const server = createServer(async (req, res) => {
    let text = "";
    for await (const chunk of req) text += chunk;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(reply(JSON.parse(text))));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    await run(
      `http://127.0.0.1:${(server.address() as { port: number }).port}`,
    );
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}
test("fetches and decodes a real JSON-RPC account envelope", async () => {
  const bytes = Buffer.alloc(82);
  bytes[45] = 1;
  await fixture(
    (body) => {
      assert.equal(body.method, "getAccountInfo");
      return {
        jsonrpc: "2.0",
        id: 1,
        result: {
          context: { slot: 123 },
          value: {
            owner: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
            executable: false,
            data: [bytes.toString("base64"), "base64"],
          },
        },
      };
    },
    async (endpoint) => {
      const report = await inspectMint(
        mint,
        "devnet",
        createRpcReader(endpoint),
      );
      assert.equal(report.source, "rpc");
      assert.equal(report.slot, 123);
      assert.equal(report.mintInfo.hook.status, "legacy");
      assert.equal(report.extra.status, "not-requested");
    },
  );
});
for (const [name, value, code] of [
  [
    "missing",
    { jsonrpc: "2.0", id: 1, result: { context: { slot: 1 }, value: null } },
    "ACCOUNT_NOT_FOUND",
  ],
  [
    "rate",
    { jsonrpc: "2.0", id: 1, error: { code: 429, message: "rate limited" } },
    "RPC_ERROR",
  ],
  ["malformed", { jsonrpc: "2.0", id: 1, result: {} }, "RPC_INVALID_RESPONSE"],
] as const)
  test(`reports ${name} responses honestly`, async () => {
    await fixture(
      () => value,
      async (endpoint) => {
        await assert.rejects(
          () => inspectMint(mint, "mainnet", createRpcReader(endpoint)),
          (e: unknown) => (e as { code: string }).code === code,
        );
      },
    );
  });
test("invalid mint never triggers a network request", async () => {
  await assert.rejects(
    () => inspectMint("bad", "devnet", createRpcReader("http://127.0.0.1:1")),
    (e: unknown) => (e as { code: string }).code === "BAD_ADDRESS",
  );
});
test("rejects an older context instead of presenting it as current", async () => {
  await fixture(
    () => ({
      jsonrpc: "2.0",
      id: 1,
      result: { context: { slot: 1 }, value: null },
    }),
    async (endpoint) => {
      await assert.rejects(() => createRpcReader(endpoint).read(mint, 20));
    },
  );
});
test("configured example exercises PDA derivation and extra-account decoding", async () => {
  const { example } = await import("../src/examples.js");
  const r = (await example("configured"))!;
  assert.equal(r.source, "example");
  assert.equal(r.program.status, "found");
  assert.equal(r.extra.status, "found");
  assert.equal(r.extra.entries.length, 2);
  assert.equal(r.extra.entries[1]?.kind, "hook-pda");
  assert.ok(r.extra.address);
});
test("timeout and invalid base64 never become successful reports", async () => {
  await fixture(
    () => ({
      jsonrpc: "2.0",
      id: 1,
      result: {
        context: { slot: 1 },
        value: {
          owner: "11111111111111111111111111111111",
          executable: false,
          data: ["@@@", "base64"],
        },
      },
    }),
    async (endpoint) => {
      await assert.rejects(
        () => createRpcReader(endpoint).read(mint),
        (e: unknown) => (e as { code: string }).code === "RPC_INVALID_RESPONSE",
      );
    },
  );
  const server = createServer(() => {});
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    await assert.rejects(
      () =>
        createRpcReader(
          `http://127.0.0.1:${(server.address() as { port: number }).port}`,
          50,
        ).read(mint),
      (e: unknown) => (e as { code: string }).code === "RPC_TIMEOUT",
    );
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
test("live configured-hook path validates secondary accounts and preserves partial failures", async () => {
  const mintAddress = "QWmroo4YnnMqYW3cnxWkFdaTxGD3P7vMSzwMHGbUzwF",
    programAddress = "cGfHiC6Kgg3FpFZvgwGcswsCRtp4aBP2fzuXRQPizuN";
  const bytes = Buffer.alloc(234);
  bytes[45] = 1;
  bytes[165] = 1;
  bytes.writeUInt16LE(14, 166);
  bytes.writeUInt16LE(64, 168);
  bytes.fill(7, 170, 202);
  bytes.fill(9, 202);
  const { createHash } = await import("node:crypto");
  const metadata = Buffer.alloc(51);
  createHash("sha256")
    .update("spl-transfer-hook-interface:execute")
    .digest()
    .copy(metadata, 0, 0, 8);
  metadata.writeUInt32LE(39, 8);
  metadata.writeUInt32LE(1, 12);
  metadata.fill(8, 17, 49);
  for (const mode of ["complete", "missing", "wrong-owner", "program-error"]) {
    const seen: string[] = [];
    await fixture(
      (body) => {
        const [key, options] = body.params as [
          string,
          { minContextSlot?: number },
        ];
        seen.push(key);
        assert.equal(body.method, "getAccountInfo");
        if (key !== mintAddress) assert.equal(options.minContextSlot, 123);
        if (mode === "program-error" && key === programAddress)
          return {
            jsonrpc: "2.0",
            id: 1,
            error: { code: -32000, message: "unavailable" },
          };
        const value =
          key === mintAddress
            ? {
                owner: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
                executable: false,
                data: [bytes.toString("base64"), "base64"],
              }
            : mode === "missing"
              ? null
              : key === programAddress
                ? {
                    owner: "BPFLoaderUpgradeab1e11111111111111111111111",
                    executable: true,
                    data: ["", "base64"],
                  }
                : {
                    owner:
                      mode === "wrong-owner"
                        ? "11111111111111111111111111111111"
                        : programAddress,
                    executable: false,
                    data: [metadata.toString("base64"), "base64"],
                  };
        return {
          jsonrpc: "2.0",
          id: 1,
          result: { context: { slot: 123 }, value },
        };
      },
      async (endpoint) => {
        const r = await inspectMint(
          mintAddress,
          "devnet",
          createRpcReader(endpoint),
        );
        assert.equal(r.mintInfo.hook.status, "configured");
        assert.equal(
          r.extra.address,
          "CHhqCLbRPHf31dYsRiKgyBmXP7taA1Rk5CGZC5unvuGx",
        );
        assert.equal(seen.length, 3);
        assert.equal(
          r.extra.status,
          mode === "missing"
            ? "missing"
            : mode === "wrong-owner"
              ? "unavailable"
              : "found",
        );
        if (mode === "program-error")
          assert.equal(r.program.status, "unavailable");
        if (mode === "complete") assert.equal(r.extra.entries.length, 1);
      },
    );
  }
});
