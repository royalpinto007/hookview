import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { parseArgs } from "node:util";

const { values } = parseArgs({ options: { output: { type: "string" } } });
const source = process.cwd();
const manifest = JSON.parse(await readFile("package.json", "utf8"));
const temporary = await mkdtemp(join(tmpdir(), "hookview package-"));
let server;
let logs = "";
function npm(...args) {
  const result = spawnSync("npm", args, {
    cwd: temporary,
    encoding: "utf8",
    timeout: 120000,
    maxBuffer: 8 * 1024 * 1024,
  });
  assert.equal(
    result.status,
    0,
    result.error?.message || result.stderr || result.stdout,
  );
  return result.stdout;
}
async function stop() {
  if (!server || server.exitCode !== null || server.signalCode !== null) return;
  const exited = once(server, "exit");
  server.kill("SIGTERM");
  try {
    await Promise.race([
      exited,
      delay(5000, undefined, { ref: false }).then(() => {
        throw new Error("Installed CLI did not stop");
      }),
    ]);
  } finally {
    if (server.exitCode === null && server.signalCode === null)
      server.kill("SIGKILL");
  }
}
try {
  const packed = JSON.parse(
    npm("pack", source, "--ignore-scripts", "--json"),
  )[0];
  const files = packed.files.map((file) => file.path);
  for (const required of [
    "dist/cli.js",
    "dist/server.js",
    "dist/public/index.html",
    "dist/public/app.js",
    "dist/public/styles.css",
    "dist/public/architecture.svg",
    "README.md",
    "LICENSE",
  ])
    assert(files.includes(required), `Missing package file: ${required}`);
  for (const file of files) {
    assert.match(
      file,
      /^(dist\/|docs\/|package\.json$|README\.md$|LICENSE$|CONTRIBUTING\.md$|CHANGELOG\.md$|SECURITY\.md$)/,
    );
    assert.doesNotMatch(
      file,
      /(^|\/)(\.env[^/]*|\.npmrc|\.git|src|tests|scripts|node_modules)(\/|$)|keypair|\.(pem|key|mp4|webm|tgz)$/i,
    );
  }
  const tarball = join(temporary, packed.filename);
  await writeFile(join(temporary, "package.json"), '{"private":true}\n');
  npm(
    "install",
    "--omit=dev",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    tarball,
  );
  npm("audit", "--omit=dev", "--audit-level=high");
  const cli = join(temporary, "node_modules", ".bin", "hookview");
  const run = (args) =>
    spawnSync(cli, args, { cwd: temporary, encoding: "utf8", timeout: 5000 });
  const help = run(["--help"]);
  assert.equal(help.status, 0, help.stderr || help.error?.message);
  assert.match(help.stdout, /hookview/);
  const version = run(["--version"]);
  assert.equal(version.status, 0, version.stderr);
  assert.equal(version.stdout.trim(), manifest.version);
  for (const args of [["--port", "0"], ["--unknown"]]) {
    const result = run(args);
    assert.equal(result.status, 2, result.stderr);
  }
  const socket = createServer();
  socket.listen(0, "127.0.0.1");
  await once(socket, "listening");
  const port = socket.address().port;
  await new Promise((done) => socket.close(done));
  server = spawn(cli, ["--port", String(port)], {
    cwd: temporary,
    env: { ...process.env, PORT: "invalid-env-port" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  for (const stream of [server.stdout, server.stderr])
    stream.on("data", (chunk) => {
      logs += chunk.toString();
    });
  server.on("error", (error) => {
    logs += error.message;
  });
  const base = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    if (server.exitCode !== null || server.signalCode !== null) break;
    try {
      const response = await fetch(base + "/", {
        signal: AbortSignal.timeout(300),
      });
      if (response.ok) {
        ready = (await response.text()).includes("hookview");
        if (ready) break;
      }
    } catch {
      /* Wait only for this disposable local child. */
    }
    await delay(100);
  }
  assert(ready, `Installed dashboard failed to start: ${logs}`);
  for (const route of ["/", "/app.js", "/styles.css", "/architecture.svg"]) {
    const response = await fetch(base + route);
    assert.equal(response.status, 200, route);
  }
  const report = JSON.parse(run(["--example", "configured", "--json"]).stdout);
  assert.equal(report.source, "example");
  assert.equal(report.mintInfo.hook.status, "configured");
  assert.equal(report.extra.entries.length, 2);
  const example = await (await fetch(base + "/api/examples/disabled")).json();
  assert.equal(example.mintInfo.hook.status, "disabled");
  const occupied = run(["--port", String(port)]);
  assert.equal(occupied.status, 2);
  assert.match(occupied.stderr, /already in use/);
  if (values.output) await copyFile(tarball, resolve(values.output));
  console.log(
    `Verified ${manifest.name}@${manifest.version}: ${files.length} files, ${Math.ceil(packed.size / 1024)} KiB. Clean production install, audit, executable, port handling, dashboard and offline examples passed.`,
  );
} finally {
  await stop();
  await rm(temporary, { recursive: true, force: true });
}
