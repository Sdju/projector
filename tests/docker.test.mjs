import { expect, onTestFinished, test } from "vite-plus/test";
import { mkdtemp, mkdir, writeFile, readFile, stat, symlink, rm } from "node:fs/promises";
import { delimiter, join } from "node:path";
import { installNodeCommand } from "./fixtures/node-shim.mjs";
import { tmpdir } from "node:os";
import { createServer } from "node:http";
import { once } from "node:events";

// Never touch the real OS keyring from tests.
process.env.PROJECTOR_SECRET_STORE = "file";

test("Docker integration: persisted binding, explicit context, guarded actions and real PTY transport", async () => {
  const root = await mkdtemp(join(tmpdir(), "projector-docker-test-"));
  const original = { ...process.env };
  const bin = join(root, "bin");
  const directory = join(root, "project with spaces");
  const trace = join(root, "argv.jsonl");
  await mkdir(bin);
  await mkdir(directory);
  process.env.XDG_DATA_HOME = join(root, "data");
  process.env.PATH = `${bin}${delimiter}${process.env.PATH}`;
  process.env.PROJECTOR_DOCKER_TEST_TRACE = trace;
  process.env.DOCKER_HOST = "tcp://must-not-use:2375";
  process.env.DOCKER_CONTEXT = "must-not-use";
  const id = "a".repeat(64);
  const inspected = {
    Id: id,
    Name: "/fixture-web-1",
    Config: {
      Image: "fixture:latest",
      Labels: { "com.docker.compose.project": "fixture", "com.docker.compose.service": "web" },
    },
    State: { Status: "running", Running: true, ExitCode: 0, Health: { Status: "healthy" } },
    NetworkSettings: {
      Ports: {
        "8000/tcp": [{ HostIp: "0.0.0.0", HostPort: "43210" }],
        "9000/tcp": [{ HostIp: "::", HostPort: "43211" }],
      },
    },
    Mounts: [{ Type: "bind", Source: directory, Destination: "/work", RW: true }],
  };
  // Fake Docker engine/CLI, but use the real execFile and node-pty transports.
  await installNodeCommand(
    bin,
    "docker",
    `import { appendFileSync } from 'node:fs';
const args = process.argv.slice(2);
appendFileSync(process.env.PROJECTOR_DOCKER_TEST_TRACE, JSON.stringify({ args, host: process.env.DOCKER_HOST, context: process.env.DOCKER_CONTEXT }) + '\\n');
if (args[0] === 'context') console.log(JSON.stringify({ Name: 'default', DockerEndpoint: '${process.platform === "win32" ? "npipe:////./pipe/fixture" : "unix:///fixture.sock"}' }) + '\\n' + JSON.stringify({ Name: 'remote', DockerEndpoint: 'ssh://remote' }));
else if (args.includes('info')) { if (process.env.PROJECTOR_TEST_DOCKER_DOWN) { console.error('Cannot connect to Docker daemon'); process.exit(1); } console.log('27.5.1'); }
else if (args.includes('version')) console.log('5.5.1');
else if (args.includes('ps')) console.log('${id}');
else if (args.includes('inspect')) console.log(JSON.stringify([${JSON.stringify(inspected)}]));
else if (args.includes('exec')) { console.log('SHELL_READY'); process.stdin.once('data', (data) => { console.log('INPUT:' + data.toString().trim()); process.exit(7); }); }
else if (args.includes('logs')) console.log('FIXTURE_LOG');
else if (args.includes('build')) setTimeout(() => { console.log('BUILD_DONE'); process.exit(0); }, 1000);
else { console.log('OPERATION_DONE'); }
`,
  );
  await writeFile(
    join(directory, "compose.yaml"),
    "services:\n  web:\n    image: fixture:latest\n",
  );
  await writeFile(join(directory, "override.yaml"), "services: {}\n");
  await writeFile(join(directory, ".env.local"), "SECRET=never-return\n");
  await writeFile(join(root, "outside.yaml"), "services: {}\n");
  await symlink(join(root, "outside.yaml"), join(directory, "escape.yaml"));
  const project = {
    id: "docker-test",
    name: "Docker test",
    path: directory,
    url: "",
    icon: "",
    mode: "server",
    defaultCommandId: "",
    commands: [],
    createdAt: "",
  };
  await mkdir(join(root, "data/projector"), { recursive: true });
  await writeFile(
    join(root, "data/projector/projects.json"),
    JSON.stringify({ projects: [project] }),
  );
  const { dockerSnapshot, configureDocker, bindDocker, dockerAction, dockerLogs } =
    await import("../server/modules/docker/index.ts");
  const { listTerminalSessions, closeTerminalSession, resolveTerminalFile } =
    await import("../server/modules/terminal/index.ts");
  const { handleApi } = await import("../server/app/api.ts");
  const server = createServer((req, res) => void handleApi(req, res));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const url = `http://127.0.0.1:${server.address().port}`;
  const waitExit = async (session) => {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const current = listTerminalSessions(project.id).find((item) => item.id === session.id);
      if (current?.status === "exited") return current;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error("PTY did not exit");
  };
  onTestFinished(async () => {
    for (const session of listTerminalSessions(project.id))
      closeTerminalSession(project.id, session.id);
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    process.env = original;
    await rm(root, { recursive: true, force: true });
  });
  expect((await dockerSnapshot(project)).enabled).toBe(false);
  await expect(
    dockerAction(project, { action: "start", context: "default", containerId: id }),
  ).rejects.toThrow(/Включите Docker/);
  await expect(configureDocker({ enabled: true, context: "remote" })).rejects.toThrow(/локальный/);
  await configureDocker({ enabled: true, context: "default" });
  if (process.platform !== "win32")
    if (process.platform !== "win32")
      expect((await stat(join(root, "data/projector/integrations.json"))).mode & 0o777).toBe(0o600);
  const binding = {
    context: "default",
    name: "fixture",
    files: ["compose.yaml", "override.yaml"],
    profiles: ["dev"],
    envFiles: [".env.local"],
  };
  await bindDocker(project.id, directory, binding);
  expect((await dockerSnapshot(project)).binding).toStrictEqual(binding);
  await expect(
    bindDocker(project.id, directory, { ...binding, files: ["../outside.yaml"] }),
  ).rejects.toThrow(/внутри/);
  await expect(
    bindDocker(project.id, directory, { ...binding, files: ["escape.yaml"] }),
  ).rejects.toThrow(/внутри/);
  await expect(
    bindDocker(project.id, directory, { ...binding, profiles: ["--help"] }),
  ).rejects.toThrow(/profile/);
  const snapshot = await dockerSnapshot(project);
  expect(snapshot.connected).toBe(true);
  expect(snapshot.containers[0].health).toBe("healthy");
  expect(snapshot.containers[0].ports[0].url).toBe("http://127.0.0.1:43210");
  expect(snapshot.containers[0].ports[1].url).toBe("http://[::1]:43211");
  expect(!JSON.stringify(snapshot).includes("never-return")).toBeTruthy();
  process.env.PROJECTOR_TEST_DOCKER_DOWN = "1";
  const down = await dockerSnapshot(project);
  expect(down.connected).toBe(false);
  expect(down.containers.length).toBe(0);
  expect(down.error).toMatch(/Cannot connect/);
  delete process.env.PROJECTOR_TEST_DOCKER_DOWN;
  await expect(dockerAction(project, { action: "down", context: "default" })).rejects.toThrow(
    /Подтвердите/,
  );
  await expect(
    dockerAction(project, {
      action: "remove",
      context: "default",
      containerId: id,
      confirm: true,
    }),
  ).rejects.toThrow(/Сначала остановите/);
  await expect(
    dockerAction(project, { action: "shell", context: "default", containerId: "--help" }),
  ).rejects.toThrow(/containerId/);
  await expect(
    dockerAction(project, {
      action: "shell",
      context: "default",
      containerId: id,
      shell: "sh; touch /tmp/bad",
    }),
  ).rejects.toThrow(/shell/);
  expect((await dockerLogs("default", id)).text).toMatch(/FIXTURE_LOG/);
  const build = await dockerAction(project, { action: "build", context: "default" });
  await expect(dockerAction(project, { action: "up", context: "default" })).rejects.toThrow(
    /Дождитесь/,
  );
  await bindDocker("other-project", directory, binding);
  await expect(
    dockerAction({ ...project, id: "other-project" }, { action: "up", context: "default" }),
  ).rejects.toThrow(/Дождитесь/);
  expect((await waitExit(build.session)).exitCode).toBe(0);
  const shell = await dockerAction(project, {
    action: "shell",
    context: "default",
    containerId: id,
  });
  const hostState = globalThis.projectorTerminals;
  const internal = hostState.sessions.get(shell.session.id);
  const output = [];
  internal.pty.onData((data) => output.push(data));
  await new Promise((resolve) => setTimeout(resolve, 100));
  internal.pty.write("hello Docker\r");
  expect((await waitExit(shell.session)).exitCode).toBe(7);
  expect(output.join("")).toMatch(/INPUT:hello Docker/);
  await expect(resolveTerminalFile(project, shell.session.id, "/etc/passwd")).rejects.toThrow(
    /не сопоставлены/,
  );
  const noOrigin = await fetch(`${url}/api/docker/settings`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled: false, context: "default" }),
  });
  expect(noOrigin.status).toBe(403);
  const restarted = await fetch(`${url}/api/projects/${project.id}/terminals/${shell.session.id}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: url },
    body: JSON.stringify({ action: "restart" }),
  });
  expect(restarted.status).toBe(409);
  const records = (await readFile(trace, "utf8")).trim().split("\n").map(JSON.parse);
  expect(records.every((item) => !item.host && !item.context)).toBeTruthy();
  const buildArgs = records.find((item) => item.args.includes("build")).args;
  expect(buildArgs.slice(0, 3)).toStrictEqual(["--context", "default", "compose"]);
  expect(buildArgs.includes(join(directory, "override.yaml"))).toBeTruthy();
  expect(buildArgs.includes(join(directory, ".env.local"))).toBeTruthy();
  expect(!buildArgs.includes("--volumes")).toBeTruthy();
  await bindDocker(project.id, directory, { binding: null });
  expect((await dockerSnapshot(project)).binding).toBe(null);
  // Disabling must remain possible even after Docker CLI was uninstalled.
  await rm(join(bin, "docker"));
  await configureDocker({ enabled: false, context: "default" });
  expect((await dockerSnapshot(project)).enabled).toBe(false);
});
