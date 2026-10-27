#!/usr/bin/env node
import { parseArgs } from "node:util";
import { readFile } from "node:fs/promises";
import { inspectMint } from "./inspect.js";
import { markdown } from "./report.js";
import { example, EXAMPLES } from "./examples.js";
import { InspectorError } from "./errors.js";
try {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      help: { type: "boolean", short: "h" },
      version: { type: "boolean" },
      port: { type: "string" },
      network: { type: "string", default: "mainnet" },
      json: { type: "boolean" },
      example: { type: "string" },
    },
  });
  if (values.help)
    console.log(
      "hookview [mint-address] [--network mainnet|devnet] [--json]\n\nNo mint: start the local dashboard (default port 4470).\n  --example configured|disabled|plain|legacy   Offline fictional fixture\n  --port PORT\n  --version\n\nRead-only public RPC. No wallet, signing or payments.\nExit: 0 inspection, 1 lookup failure, 2 usage/server error.",
    );
  else if (values.version)
    console.log(
      (
        JSON.parse(
          await readFile(new URL("../package.json", import.meta.url), "utf8"),
        ) as { version: string }
      ).version,
    );
  else {
    if (
      positionals.length > 1 ||
      !["mainnet", "devnet"].includes(values.network!) ||
      (values.example && positionals.length)
    )
      throw new Error("Invalid arguments. Run hookview --help.");
    if (positionals[0] || values.example) {
      if (values.port) throw new Error("--port applies to the dashboard only.");
      const r = values.example
        ? await example(values.example)
        : await inspectMint(
            positionals[0]!,
            values.network as "mainnet" | "devnet",
          );
      if (!r)
        throw new Error(
          "Unknown example. Choose " + EXAMPLES.map((e) => e.id).join(", "),
        );
      process.stdout.write(
        values.json ? JSON.stringify(r, null, 2) + "\n" : markdown(r),
      );
    } else {
      if (values.json)
        throw new Error("Provide a mint or --example for JSON output.");
      const raw = values.port ?? process.env.PORT ?? "4470";
      if (!/^\d+$/.test(raw) || Number(raw) < 1 || Number(raw) > 65535)
        throw new Error("Port must be an integer from 1 to 65535.");
      const { createServer } = await import("./server.js");
      const server = createServer();
      server.on("error", (error) => {
        console.error(
          (error as NodeJS.ErrnoException).code === "EADDRINUSE"
            ? "Port is already in use. Choose --port PORT."
            : "Could not start the local dashboard.",
        );
        process.exitCode = 2;
      });
      server.listen(Number(raw), "127.0.0.1", () =>
        console.log(
          `hookview → http://127.0.0.1:${raw}\nRead-only inspection. Press Ctrl+C to stop.`,
        ),
      );
      for (const signal of ["SIGINT", "SIGTERM"] as const)
        process.on(signal, () => {
          server.closeAllConnections();
          server.close();
        });
    }
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : "Inspection failed.");
  process.exitCode = error instanceof InspectorError ? 1 : 2;
}
