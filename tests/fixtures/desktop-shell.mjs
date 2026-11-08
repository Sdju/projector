import assert from "node:assert/strict";
import { spawn, execFile } from "node:child_process";
import { once } from "node:events";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { os } from "../../packages/core/modules/os/index.ts";

// Run under a private dbus-run-session, without a GI loader or a display.
const self = fileURLToPath(import.meta.url);
const [role, action] = process.argv.slice(2);
if (role === "resident") {
  await os.runDesktop("http://unused.test", action, {
    dataDirectory: process.env.XDG_DATA_HOME,
    webPalette: true,
    createPalette: async () => {
      console.log("CREATED");
      return {
        show: async () => console.log("SHOW"),
        toggle: async () => console.log("TOGGLE"),
        invokeSelected: async () => {},
        openPage() {},
        quitProjector: async () => {},
        restartProjector: async () => {},
        dispose: () => console.log("DISPOSED"),
      };
    },
  });
} else {
  const resident = spawn(process.execPath, [self, "resident", "tray"], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  let errors = "";
  resident.stdout.on("data", (data) => (output += data));
  resident.stderr.on("data", (data) => (errors += data));
  const closed = once(resident, "exit");
  try {
    const deadline = Date.now() + 10000;
    while (!output.includes("READY") && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 20));
    assert.match(output, /READY/, errors);
    assert.doesNotMatch(output, /CREATED/, "tray starts before creating a palette");
    for (const command of ["show", "toggle", "tray", "quit"]) {
      const reply = await promisify(execFile)(process.execPath, [self, "resident", command]);
      assert.match(reply.stdout, /READY/);
    }
    assert.deepEqual(await closed, [0, null]);
    assert.equal(output.match(/CREATED/g)?.length, 1);
    assert.match(output, /SHOW/);
    assert.match(output, /TOGGLE/);
    assert.match(output, /DISPOSED/);
    console.log("shell forwarding and cleanup passed without GTK");
  } finally {
    resident.kill();
  }

  // Exercise the real web resident. Its request must stay in web mode even if a native
  // add-on appears later, otherwise /app/open can forward into the same resident forever.
  const directory = await mkdtemp(join(tmpdir(), "projector-web-shell-"));
  const requests = [];
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    assert.equal(req.url, "/api/app/open");
    requests.push(JSON.parse(body));
    res.setHeader("Content-Type", "application/json");
    res.end('{"ok":true}');
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const url = `http://127.0.0.1:${server.address().port}`;
  const helper = fileURLToPath(new URL("../../packages/cli/app/desktop.ts", import.meta.url));
  const env = { ...process.env, XDG_DATA_HOME: directory };
  const web = spawn(process.execPath, [helper, "native", url, "tray"], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const webClosed = once(web, "exit");
  let ready = "";
  web.stdout.on("data", (data) => (ready += data));
  try {
    const deadline = Date.now() + 10000;
    while (!ready.includes("READY") && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 20));
    assert.match(ready, /READY/);
    const command = (action) =>
      promisify(execFile)(process.execPath, [helper, "native", url, action], { env });
    await command("show");
    assert.deepEqual(requests.shift(), { toggle: false, mode: "browser" });
    await mkdir(join(directory, "projector"), { recursive: true });
    await writeFile(join(directory, "projector/launcher.json"), '{"mode":"window"}');
    await command("toggle");
    assert.deepEqual(requests.shift(), { toggle: true, mode: "window" });
    await command("quit");
    assert.deepEqual(await webClosed, [0, null]);
  } finally {
    web.kill();
    server.close();
    await rm(directory, { recursive: true, force: true });
  }
}
