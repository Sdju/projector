import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { expect, onTestFinished, test } from "vite-plus/test";
import { parseArgs } from "../modules/arguments/index.ts";

const run = promisify(execFile);
const launch = fileURLToPath(new URL("../app/launch.ts", import.meta.url));

test("CLI parsing keeps the old flags and accepts project commands", () => {
  expect(parseArgs([])).toMatchObject({ command: "open", target: undefined });
  expect(parseArgs(["--browser"])).toMatchObject({
    command: "open",
    options: { mode: "browser" },
  });
  expect(parseArgs(["open", "/tmp/app", "--window", "--json"])).toMatchObject({
    command: "open",
    target: "/tmp/app",
    options: { mode: "window", json: true },
  });
  expect(parseArgs(["run", "app", "--command", "test"])).toMatchObject({
    command: "run",
    target: "app",
    options: { command: "test" },
  });
  expect(parseArgs(["list"]).command).toBe("projects");
  expect(parseArgs(["ls"]).command).toBe("projects");
  expect(parseArgs(["serve"]).command).toBe("start");
  expect(parseArgs(["mode", "prod"])).toMatchObject({ command: "mode", target: "prod" });
  expect(parseArgs(["--quit"])).toMatchObject({ command: "quit" });
  expect(parseArgs(["--server"])).toMatchObject({ command: "start", options: { server: true } });
  expect(parseArgs(["search", "two", "words"])).toMatchObject({
    command: "search",
    target: "two words",
  });
  expect(parseArgs(["/tmp/app"]).command).toBe("open");
  expect(() => parseArgs(["--unknown"])).toThrow("Неизвестный флаг");
});

test("CLI project commands use the running server and do not start another one", async () => {
  const root = await mkdtemp(join(tmpdir(), "projector-cli-"));
  const data = join(root, "data");
  const folder = join(root, "workspace");
  await mkdir(folder);
  const requests = [];
  let base = "";
  const project = {
    id: "p1",
    name: "Alpha",
    path: join(root, "alpha"),
    url: "",
    icon: "",
    mode: "server",
    defaultCommandId: "dev",
    commands: [{ id: "dev", name: "dev", cmd: "true" }],
    createdAt: "2026-01-01",
    runtime: {
      projectId: "p1",
      commandId: null,
      commandName: null,
      status: "idle",
      pid: null,
      url: null,
      startedAt: null,
      exitCode: null,
    },
  };
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      const payload = body ? JSON.parse(body) : undefined;
      requests.push({ method: req.method, url: req.url, body: payload });
      const reply = (value, status = 200) => {
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(value));
      };
      if (req.url === "/api/health")
        return reply({
          ok: true,
          app: "projector",
          pid: 1234,
          url: base,
          mode: "dev",
          network: { mode: "local" },
        });
      if (req.url === "/api/projects" && req.method === "GET")
        return reply({ projects: [project] });
      if (req.url === "/api/launcher/launch" && req.method === "POST")
        return reply({ ok: true, route: "/projects/tmp/workspace" });
      if (req.url === "/api/app/open" && req.method === "POST")
        return reply({
          ok: true,
          url: `${base}${payload.route ?? "/"}`,
          mode: payload.mode ?? "browser",
        });
      if (req.url === "/api/projects/p1/start" && req.method === "POST")
        return reply({
          runtime: {
            ...project.runtime,
            status: "running",
            commandId: "dev",
            commandName: "dev",
            pid: 4321,
            url: "http://localhost:3000",
          },
        });
      if (req.url === "/api/projects/p1/stop" && req.method === "POST")
        return reply({ runtime: project.runtime });
      if (req.url?.startsWith("/api/launcher/search"))
        return reply({
          items: [
            {
              id: "project:p1",
              kind: "project",
              name: "Alpha",
              description: "проект",
              keywords: project.path,
              route: "/projects/tmp/alpha",
            },
          ],
        });
      return reply({ error: "not found" }, 404);
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  base = `http://127.0.0.1:${server.address().port}`;
  onTestFinished(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  });

  const cli = async (...args) => {
    const { stdout, stderr } = await run(process.execPath, [launch, ...args], {
      env: { ...process.env, PROJECTOR_URL: base, XDG_DATA_HOME: data },
      timeout: 15_000,
    });
    expect(stderr).toBe("");
    return JSON.parse(stdout);
  };

  const projects = await cli("projects", "--json");
  expect(projects.source).toBe("server");
  expect(projects.projects[0]).toMatchObject({ id: "p1", name: "Alpha" });

  const status = await cli("status", "--json");
  expect(status).toMatchObject({ server: { pid: 1234 }, running: 0, projects: [{ id: "p1" }] });

  const opened = await cli("open", folder, "--json");
  const launchRequest = requests.find((item) => item.url === "/api/launcher/launch");
  expect(launchRequest.body).toMatchObject({ id: `path:${folder}`, action: "open", inline: true });
  expect(opened.route).toBe("/projects/tmp/workspace");

  const byName = await cli("open", "Alpha", "--json");
  expect(requests.at(-2).body).toMatchObject({ id: "project:p1", action: "open", inline: true });
  expect(byName.url).toContain("/projects/tmp/workspace");

  await cli("open", "Alpha", "--window", "--json");
  expect(requests.at(-1).body).toMatchObject({
    route: "/projects/tmp/workspace",
    mode: "window",
  });

  const started = await cli("run", "Alpha", "--json");
  expect(started.runtime).toMatchObject({ status: "running", pid: 4321 });

  const stopped = await cli("stop", "Alpha", "--json");
  expect(stopped.runtime.status).toBe("idle");

  const search = await cli("search", "alpha", "--json");
  expect(search.items[0]).toMatchObject({ id: "project:p1", name: "Alpha" });
});

test("CLI reads projects from disk when the server is stopped", async () => {
  const root = await mkdtemp(join(tmpdir(), "projector-cli-offline-"));
  const data = join(root, "data");
  await mkdir(join(data, "projector"), { recursive: true });
  await writeFile(
    join(data, "projector", "projects.json"),
    JSON.stringify({
      projects: [
        {
          id: "offline",
          name: "Offline",
          path: join(root, "offline"),
          url: "",
          icon: "",
          mode: "server",
          defaultCommandId: "dev",
          commands: [{ id: "dev", name: "dev", cmd: "true" }],
          createdAt: "2026-01-01",
        },
      ],
    }),
  );
  onTestFinished(() => rm(root, { recursive: true, force: true }));

  const cli = async (...args) => {
    const { stdout, stderr } = await run(process.execPath, [launch, ...args], {
      env: {
        ...process.env,
        PROJECTOR_URL: "http://127.0.0.1:9",
        XDG_DATA_HOME: data,
      },
      timeout: 15_000,
    });
    expect(stderr).toBe("");
    return JSON.parse(stdout);
  };

  const projects = await cli("projects", "--json");
  expect(projects).toMatchObject({
    source: "disk",
    projects: [{ id: "offline", name: "Offline" }],
  });
  const status = await cli("status", "--json");
  expect(status).toMatchObject({
    server: null,
    running: 0,
    projects: [{ id: "offline" }],
  });
});
