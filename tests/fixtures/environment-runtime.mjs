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
import { join, sep } from "node:path";
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
  await cp(join(source, "packages"), join(root, "packages"), {
    recursive: true,
    filter: (entry) => !entry.split(sep).includes("node_modules"),
  });
  await cp(join(source, "resources"), join(root, "resources"), { recursive: true });
  // Third-party dependencies stay in the working checkout; workspace links point at the copy.
  const workspace = await readdir(join(source, "packages"));
  for (const name of workspace) {
    const modules = join(root, "packages", name, "node_modules");
    await mkdir(join(modules, "@projector"), { recursive: true });
    for (const entry of await readdir(join(source, "packages", name, "node_modules")).catch(
      () => [],
    )) {
      if (entry === "@projector") continue;
      await symlink(
        join(source, "packages", name, "node_modules", entry),
        join(modules, entry),
        "junction",
      );
    }
    for (const dependency of workspace)
      await symlink(
        join(root, "packages", dependency),
        join(modules, "@projector", dependency),
        "junction",
      );
  }
  const external = new Set();
  for (const name of ["server", "core"]) {
    const manifest = JSON.parse(
      await readFile(join(source, "packages", name, "package.json"), "utf8"),
    );
    for (const dependency of Object.keys(manifest.dependencies ?? {})) external.add(dependency);
  }
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
  const plugin = join(root, "packages/server/app/plugin.ts");
  await writeFile(
    plugin,
    (await readFile(plugin, "utf8")).replace("os.capabilities.nativeDesktop", "false"),
  );
  const configFile = join(root, "vite.config.ts");
  await writeFile(
    configFile,
    `
    import { projectorPlugin } from './packages/server/app/dev-plugin.ts';
    export default {
      plugins: [projectorPlugin()],
      ssr: { external: ${JSON.stringify([...external].filter((name) => !name.startsWith("@projector/")))} },
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
  const healthFile = join(root, "packages/server/routes/api/health.ts");
  await writeFile(
    join(root, "packages/server/app/deferred.ts"),
    'export const value = "loaded later";',
  );
  const healthSource = (await readFile(healthFile, "utf8"))
    // The fixture injects a deferred import even when the real health handler is synchronous.
    .replace(/handler:\s*(?:async\s+)?\(/, "handler: async (")
    .replace(
      "ok: true,",
      'ok: true, deferred: (await import(new URL("../../app/deferred.ts", import.meta.url).href)).value,',
    );
  const health = (revision) =>
    healthSource.replace("ok: true,", `ok: true, revision: ${revision},`);
  const controlFile = join(root, "packages/server/modules/terminal-control/control.ts");
  const controlSource = await readFile(controlFile, "utf8");
  // Two reloads cover both a socket-driven and an HTTP-driven update; the error/recovery tail below
  // adds more generations without a fresh workspace. A release sweep can request the full twelve.
  const generations = Number(process.env.PROJECTOR_TEST_GENERATIONS ?? 2);
  let controlRevision = 0;
  let healthRevision = 0;
  for (let revision = 1; revision <= generations; revision++) {
    if (revision % 2 === 1) {
      controlRevision = revision;
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
    } else {
      healthRevision = revision;
      await writeFile(healthFile, health(revision));
      await until(
        async () => (await call("/api/health")).revision === revision,
        `HTTP generation ${revision}`,
      );
    }
    // The module that did not change keeps serving its last revision through the same transport.
    if (healthRevision > 0) assert.equal((await call("/api/health")).revision, healthRevision);
    control.socket.send(JSON.stringify({ id: 1000 + revision, method: "GET" }));
    await until(
      () =>
        control.messages.some(
          (m) => m.id === 1000 + revision && m.data?.revision === controlRevision,
        ),
      `control stays live after generation ${revision}`,
    );
    assert.equal(server.environments.ssr, environment);
    assert.equal((await call("/api/health")).pid, process.pid);
    assert.equal(data.socket.readyState, WebSocket.OPEN);
    console.log(`live generation ${revision}`);
  }
  const workingErrors = errors.length;
  const broken = healthRevision;
  const recovered = healthRevision + 1;
  const restored = healthRevision + 2;
  const mutated = healthRevision + 3;
  await writeFile(healthFile, "export const broken = ;");
  await until(() => errors.length > workingErrors, "invalid update rejected");
  assert.equal((await call("/api/health")).revision, broken);
  await writeFile(healthFile, health(recovered));
  await until(
    async () => (await call("/api/health")).revision === recovered,
    "syntax error recovery",
  );
  const recoveredErrors = errors.length;
  await unlink(healthFile);
  await until(() => errors.length > recoveredErrors, "deleted module rejected");
  assert.equal((await call("/api/health")).revision, recovered);
  await writeFile(healthFile, health(restored));
  await until(
    async () => (await call("/api/health")).revision === restored,
    "deleted module restored",
  );
  await writeFile(
    healthFile,
    health(mutated).replace(
      "export const routes: RouteDefinition[] = [",
      'export const routes: RouteDefinition[] = [{ method: "POST", path: "/api/test-once", handler: () => { globalThis.testMutations = (globalThis.testMutations ?? 0) + 1; throw new Error("request failure"); } },',
    ),
  );
  await until(
    async () => (await call("/api/health")).revision === mutated,
    "mutation test activated",
  );
  const parallel = await Promise.all(Array.from({ length: 20 }, () => call("/api/health")));
  assert(parallel.every((m) => m.revision === mutated));
  const failed = await fetch(base + "/api/test-once", {
    method: "POST",
    headers: { Origin: base },
  });
  assert.equal(failed.status, 400);
  await failed.text();
  assert.equal(globalThis.testMutations, 1);
  const { broadcastEvent } = await environment.runner.import(
    "/packages/server/modules/events/index.ts",
  );
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
  const socketFile = join(root, "packages/server/modules/terminal-control/socket.ts");
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
