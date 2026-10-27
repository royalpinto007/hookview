import { isAddress } from "@solana/addresses";
import { inspectMint } from "./inspect.js";
import { example } from "./examples.js";
import { InspectorError } from "./errors.js";
import { createServer as http } from "node:http";
import { readFile } from "node:fs/promises";
const assets: Record<string, [string, string]> = {
  "/": ["index.html", "text/html; charset=utf-8"],
  "/app.js": ["app.js", "text/javascript; charset=utf-8"],
  "/styles.css": ["styles.css", "text/css; charset=utf-8"],
  "/architecture.svg": ["architecture.svg", "image/svg+xml"],
};
export function createServer(
  assetRoot = new URL("./public/", import.meta.url),
) {
  let active = 0;
  const requests: number[] = [];
  return http(async (req, res) => {
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    );
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader(
      "Permissions-Policy",
      "camera=(), microphone=(), geolocation=()",
    );
    const port = (req.socket.localPort ?? 0).toString();
    const allowed = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
    if (
      !allowed.has(req.headers.host ?? "") ||
      (req.headers.origin &&
        !allowed.has(req.headers.origin.replace(/^http:\/\//, "")))
    ) {
      res.writeHead(403);
      res.end("Local requests only.");
      return;
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, { Allow: "GET, HEAD" });
      res.end("Read-only server.");
      return;
    }
    res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
    if ((req.url?.length ?? 0) > 4096) {
      res.writeHead(414);
      res.end("Request URL is too long.");
      return;
    }
    let url: URL;
    try {
      url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
    } catch {
      res.writeHead(400);
      res.end("Invalid request URL.");
      return;
    }
    const path = url.pathname;
    function json(status: number, body: unknown) {
      res.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
      });
      res.end(req.method === "HEAD" ? undefined : JSON.stringify(body));
    }
    if (path.startsWith("/api/examples/")) {
      const id = path.slice("/api/examples/".length);
      const r = await example(id);
      json(
        r ? 200 : 404,
        r ?? { error: { code: "NOT_FOUND", message: "Example not found." } },
      );
      return;
    }
    if (path === "/api/inspect") {
      const mint = url.searchParams.get("mint") ?? "",
        network = url.searchParams.get("network");
      if (
        !isAddress(mint) ||
        (network !== "mainnet" && network !== "devnet") ||
        Array.from(url.searchParams.keys()).some(
          (k) =>
            !["mint", "network"].includes(k) ||
            url.searchParams.getAll(k).length !== 1,
        )
      ) {
        json(400, {
          error: {
            code: "BAD_INPUT",
            message: "Choose a network and enter a valid Solana mint address.",
          },
        });
        return;
      }
      const now = Date.now();
      while (requests[0] !== undefined && requests[0] < now - 60000)
        requests.shift();
      if (active >= 2 || requests.length >= 10) {
        json(429, {
          error: {
            code: "LOCAL_RATE_LIMIT",
            message: "Too many lookups. Wait a moment and retry.",
          },
        });
        return;
      }
      active++;
      requests.push(now);
      try {
        json(200, await inspectMint(mint, network));
      } catch (error) {
        const e =
          error instanceof InspectorError
            ? error
            : new InspectorError(
                "INSPECTION_FAILED",
                "Inspection could not be completed.",
                500,
              );
        json(e.status, { error: { code: e.code, message: e.message } });
      } finally {
        active--;
      }
      return;
    }
    const asset = Object.hasOwn(assets, path) ? assets[path] : undefined;
    if (!asset) {
      res.writeHead(404);
      res.end("Not found.");
      return;
    }
    try {
      const body = await readFile(new URL(asset[0], assetRoot));
      res.writeHead(200, { "Content-Type": asset[1] });
      res.end(req.method === "HEAD" ? undefined : body);
    } catch {
      res.writeHead(500);
      res.end("Build assets are missing. Run npm run build.");
    }
  });
}
