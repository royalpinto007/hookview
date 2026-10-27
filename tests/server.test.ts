import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "../src/server.js";
import { once } from "node:events";
import { get } from "node:http";
test("dashboard serves only local static routes with restrictive headers", async () => {
  const server = createServer(new URL("../public/", import.meta.url));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const port = (server.address() as { port: number }).port;
    const url = `http://127.0.0.1:${port}`;
    const home = await fetch(url);
    assert.equal(home.status, 200);
    assert.match(
      home.headers.get("content-security-policy")!,
      /connect-src 'self'/,
    );
    assert.match(await home.text(), /hookview/);
    assert.equal((await fetch(url + "/package.json")).status, 404);
    const example = await (
      await fetch(url + "/api/examples/configured")
    ).json();
    assert.equal(example.source, "example");
    assert.equal(example.extra.status, "found");
    assert.equal(
      (await fetch(url + "/api/inspect?mint=bad&network=devnet")).status,
      400,
    );
    assert.equal(
      (await fetch(url + "/api/inspect?mint=bad&network=wrong")).status,
      400,
    );
    assert.equal(
      (await fetch(url, { method: "POST", body: "private" })).status,
      405,
    );
    assert.equal(
      await new Promise<number>((resolve, reject) => {
        get(url, { headers: { host: "attacker.example" } }, (res) => {
          res.resume();
          resolve(res.statusCode!);
        }).on("error", reject);
      }),
      403,
    );
    assert.equal(
      (await fetch(url, { headers: { origin: "https://attacker.example" } }))
        .status,
      403,
    );
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
test("malformed HTTP request targets cannot crash the server", async () => {
  const { spawnSync } = await import("node:child_process");
  const code = `import {createServer} from './src/server.ts';import{get}from'node:http';const s=createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;get({host:'127.0.0.1',port:p,path:'http://[',headers:{host:'127.0.0.1:'+p}},res=>{res.resume();console.log(res.statusCode);s.close();}).on('error',()=>{process.exitCode=1;s.close();});});`;
  const r = spawnSync(
    process.execPath,
    ["--import", "tsx", "--input-type=module", "-e", code],
    { encoding: "utf8", timeout: 3000 },
  );
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), "400");
});
