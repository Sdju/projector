import assert from "node:assert/strict";
import { once } from "node:events";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { createLogger, createServer, preview } from "vite-plus";
import { WebSocket } from "ws";

const source = fileURLToPath(new URL("../..", import.meta.url));
const root = await mkdtemp(join(tmpdir(), "projector-environment-"));
const sockets = [];
const errors = [];
let server, previewServer, abort;
const until = async (check, label) => {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await sleep(25);
  }
  throw new Error(`Timed out: ${label}`);
};
try {
  for (const name of ["server", "core", "cli", "resources"])
    await cp(join(source, name), join(root, name), { recursive: true });
  const manifest = JSON.parse(await readFile(join(source, "package.json"), "utf8"));
  await writeFile(join(root, "package.json"), JSON.stringify({ type: "module" }));
  // A real directory prevents Vite's temporary config files from reaching the working checkout.
  await mkdir(join(root, "node_modules"));
  for (const name of await readdir(join(source, "node_modules"))) {
    if ([".vite", ".vite-temp", ".cache"].includes(name)) continue;
    await symlink(join(source, "node_modules", name), join(root, "node_modules", name), "junction");
  }
  process.env.XDG_DATA_HOME = join(root, "data");
  process.env.XDG_CONFIG_HOME = join(root, "config");
  process.env.PROJECTOR_NETWORK = "local";
  delete process.env.PROJECTOR_WINDOW;
  // Only the fixture suppresses desktop startup; all API and transport code is the real code.
  const plugin = join(root, "server/app/plugin.ts");
  await writeFile(
    plugin,
    (await readFile(plugin, "utf8")).replace("os.capabilities.nativeDesktop", "false"),
  );
  const configFile = join(root, "vite.config.ts");
  await writeFile(
    configFile,
    `
    import { projectorPlugin } from './server/app/dev-plugin.ts';
    export default {
      plugins: [projectorPlugin()],
      ssr: { external: ${JSON.stringify(Object.keys(manifest.dependencies))} },
      optimizeDeps: { noDiscovery: true, entries: [] },
      server: { host: '127.0.0.1', port: 0 },
      preview: { host: '127.0.0.1', port: 0 }
    };
  `,
  );
  const logger = createLogger("silent");
  logger.error = (message) => errors.push(message);
  server = await createServer({ root, configFile, customLogger: logger });
  await server.listen();
  let base = `http://127.0.0.1:${server.httpServer.address().port}`;
  const call = async (path, method = "GET", body) => {
    const res = await fetch(base + path, {
      method,
      headers: { Origin: base, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await res.json();
    assert(res.ok, `${path}: ${res.status} ${JSON.stringify(data)}`);
    return data;
  };
  const connect = async (path) => {
    const socket = new WebSocket(base.replace("http:", "ws:") + path, { origin: base });
    sockets.push(socket);
    const messages = [];
    socket.on("message", (raw) => messages.push(JSON.parse(raw.toString())));
    await once(socket, "open");
    return { socket, messages };
  };
  const project = (
    await call("/api/projects", "POST", {
      name: "Environment test",
      path: root,
      mode: "server",
      defaultCommandId: "keep",
      commands: [
        {
          id: "keep",
          name: "keep",
          cmd: "printf 'READY\\n'; while IFS= read -r line; do printf 'REPLY_%s\\n' \"$line\"; done",
        },
      ],
    })
  ).project;
  const terminal = (
    await call(`/api/projects/${project.id}/terminals`, "POST", {
      program: "shell",
      commandId: "keep",
    })
  ).session;
  assert(terminal.pid > 0);
  const data = await connect(`/api/terminal/socket?session=${terminal.id}`);
  const control = await connect(`/api/terminal/control?project=${project.id}`);
  const shared = await connect("/api/terminal/shared?kind=control");
  shared.socket.send(JSON.stringify({ type: "open", channel: "test", projectId: project.id }));
  await until(() => shared.messages.some((m) => m.type === "opened"), "shared channel opened");
  abort = new AbortController();
  const stream = await fetch(base + "/api/events?client=environment-test", {
    signal: abort.signal,
  });
  assert.equal(stream.status, 200);
  let events = "";
  void (async () => {
    try {
      for await (const value of stream.body) events += new TextDecoder().decode(value);
    } catch {}
  })();
  const environment = server.environments.ssr;
  const healthFile = join(root, "server/routes/api/health.ts");
  await writeFile(join(root, "server/app/deferred.ts"), 'export const value = "loaded later";');
  const healthSource = (await readFile(healthFile, "utf8")).replace(
    "ok: true,",
    'ok: true, deferred: (await import(new URL("../../app/deferred.ts", import.meta.url).href)).value,',
  );
  const health = (revision) =>
    healthSource.replace("ok: true,", `ok: true, revision: ${revision},`);
  const controlFile = join(root, "server/modules/terminal-control/control.ts");
  const controlSource = await readFile(controlFile, "utf8");
  for (let revision = 1; revision <= 12; revision++) {
    await writeFile(
      controlFile,
      controlSource.replace(
        "return { sessions: listTerminalSessions(id) };",
        `return { sessions: listTerminalSessions(id), revision: ${revision} };`,
      ),
    );
    // No HTTP request activates this update: already-open sockets must receive the new code.
    await until(async () => {
      control.socket.send(JSON.stringify({ id: revision, method: "GET" }));
      shared.socket.send(
        JSON.stringify({
          type: "send",
          channel: "test",
          data: JSON.stringify({ id: revision, method: "GET" }),
        }),
      );
      await sleep(40);
      return (
        control.messages.some((m) => m.id === revision && m.data?.revision === revision) &&
        shared.messages.some(
          (m) => m.type === "message" && JSON.parse(m.data).data?.revision === revision,
        )
      );
    }, `live control generation ${revision}`);
    await writeFile(healthFile, health(revision));
    await until(
      async () => (await call("/api/health")).revision === revision,
      `HTTP generation ${revision}`,
    );
    assert.equal(server.environments.ssr, environment);
    assert.equal((await call("/api/health")).pid, process.pid);
    assert.equal(data.socket.readyState, WebSocket.OPEN);
  }
  const workingErrors = errors.length;
  await writeFile(healthFile, "export const broken = ;");
  await until(() => errors.length > workingErrors, "invalid update rejected");
  assert.equal((await call("/api/health")).revision, 12);
  await writeFile(healthFile, health(13));
  await until(async () => (await call("/api/health")).revision === 13, "syntax error recovery");
  const recoveredErrors = errors.length;
  await unlink(healthFile);
  await until(() => errors.length > recoveredErrors, "deleted module rejected");
  assert.equal((await call("/api/health")).revision, 13);
  await writeFile(healthFile, health(14));
  await until(async () => (await call("/api/health")).revision === 14, "deleted module restored");
  await writeFile(
    healthFile,
    health(15).replace(
      '  if (path === "/api/health"',
      '  if (path === "/api/test-once" && method === "POST") { globalThis.testMutations = (globalThis.testMutations ?? 0) + 1; throw new Error("request failure"); }\n  if (path === "/api/health"',
    ),
  );
  await until(async () => (await call("/api/health")).revision === 15, "mutation test activated");
  const parallel = await Promise.all(Array.from({ length: 20 }, () => call("/api/health")));
  assert(parallel.every((m) => m.revision === 15));
  const failed = await fetch(base + "/api/test-once", {
    method: "POST",
    headers: { Origin: base },
  });
  assert.equal(failed.status, 400);
  await failed.text();
  assert.equal(globalThis.testMutations, 1);
  const { broadcastEvent } = await environment.runner.import("/server/modules/events/index.ts");
  broadcastEvent("environment-test", {});
  await until(() => events.includes("environment-test"), "SSE after reloads");
  assert.equal(
    (await call(`/api/projects/${project.id}/terminals/${terminal.id}`)).session.pid,
    terminal.pid,
  );
  data.socket.send(JSON.stringify({ type: "input", data: "AFTER_HMR\r" }));
  await until(
    () => data.messages.some((m) => m.data?.includes("REPLY_AFTER_HMR")),
    "PTY after reloads",
  );
  const foreign = await fetch(base + "/api/projects", {
    method: "POST",
    headers: { Origin: "https://foreign.example" },
  });
  assert.equal(foreign.status, 403);
  await foreign.text();
  // Changing transport implementation disposes its old listeners and permits a fresh connection.
  const socketFile = join(root, "server/modules/terminal-control/socket.ts");
  await writeFile(socketFile, (await readFile(socketFile, "utf8")) + "\n// transport reload\n");
  await until(() => control.socket.readyState === WebSocket.CLOSED, "old transport disposed");
  const replacement = await connect(`/api/terminal/control?project=${project.id}`);
  replacement.socket.send(JSON.stringify({ id: 100, method: "GET" }));
  await until(() => replacement.messages.some((m) => m.id === 100), "replacement transport works");
  assert.equal(
    (await call(`/api/projects/${project.id}/terminals/${terminal.id}`)).session.pid,
    terminal.pid,
  );
  abort.abort();
  for (const socket of sockets) socket.terminate();
  // Config restart replaces the environment, while global PTYs survive and transports reattach.
  await server.restart();
  base = `http://127.0.0.1:${server.httpServer.address().port}`;
  assert.notEqual(server.environments.ssr, environment);
  assert.equal(
    (await call(`/api/projects/${project.id}/terminals/${terminal.id}`)).session.pid,
    terminal.pid,
  );
  const restarted = await connect(`/api/terminal/control?project=${project.id}`);
  restarted.socket.send(JSON.stringify({ id: 101, method: "GET" }));
  await until(() => restarted.messages.some((m) => m.id === 101), "transport after config restart");
  restarted.socket.terminate();
  await server.close();
  server = undefined;
  // Preview uses its own live environment and supports the API's deferred platform imports.
  await mkdir(join(root, "dist"));
  await writeFile(join(root, "dist/index.html"), "<p>preview</p>");
  previewServer = await preview({ root, configFile, customLogger: logger });
  base = `http://127.0.0.1:${previewServer.httpServer.address().port}`;
  const previewHealth = await call("/api/health");
  assert.equal(previewHealth.mode, "prod");
  assert.equal(previewHealth.deferred, "loaded later");
  assert.equal(
    (await call(`/api/projects/${project.id}/terminals/${terminal.id}`)).session.pid,
    terminal.pid,
  );
  console.log("environment runtime passed");
} finally {
  abort?.abort();
  for (const socket of sockets) socket.terminate();
  for (const session of globalThis.projectorTerminals?.sessions?.values() ?? []) {
    try {
      session.pty.kill();
    } catch {}
  }
  await server?.close();
  if (previewServer) await new Promise((resolve) => previewServer.httpServer.close(resolve));
  await rm(root, { recursive: true, force: true });
}
process.exit(0);
