import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, writeFile, readFile, stat, symlink, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer } from "node:http";
import { once } from "node:events";

// Never touch the real OS keyring from tests.
process.env.PROJECTOR_SECRET_STORE = "file";

await test("Docker integration: persisted binding, explicit context, guarded actions and real PTY transport", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "projector-docker-test-"));
  const original = { ...process.env };
  const bin = join(root, "bin");
  const directory = join(root, "project with spaces");
  const trace = join(root, "argv.jsonl");
  await mkdir(bin);
  await mkdir(directory);
  process.env.XDG_DATA_HOME = join(root, "data");
  process.env.PATH = `${bin}:${process.env.PATH}`;
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
  await writeFile(
    join(bin, "docker"),
    `#!/usr/bin/env node
import { appendFileSync } from 'node:fs';
const args = process.argv.slice(2);
appendFileSync(process.env.PROJECTOR_DOCKER_TEST_TRACE, JSON.stringify({ args, host: process.env.DOCKER_HOST, context: process.env.DOCKER_CONTEXT }) + '\\n');
if (args[0] === 'context') console.log(JSON.stringify({ Name: 'default', DockerEndpoint: 'unix:///fixture.sock' }) + '\\n' + JSON.stringify({ Name: 'remote', DockerEndpoint: 'ssh://remote' }));
else if (args.includes('info')) { if (process.env.PROJECTOR_TEST_DOCKER_DOWN) { console.error('Cannot connect to Docker daemon'); process.exit(1); } console.log('27.5.1'); }
else if (args.includes('version')) console.log('5.5.1');
else if (args.includes('ps')) console.log('${id}');
else if (args.includes('inspect')) console.log(JSON.stringify([${JSON.stringify(inspected)}]));
else if (args.includes('exec')) { console.log('SHELL_READY'); process.stdin.once('data', (data) => { console.log('INPUT:' + data.toString().trim()); process.exit(7); }); }
else if (args.includes('logs')) console.log('FIXTURE_LOG');
else if (args.includes('build')) setTimeout(() => { console.log('BUILD_DONE'); process.exit(0); }, 1000);
else { console.log('OPERATION_DONE'); }
`,
    { mode: 0o700 },
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
  t.after(async () => {
    for (const session of listTerminalSessions(project.id))
      closeTerminalSession(project.id, session.id);
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    process.env = original;
    await rm(root, { recursive: true, force: true });
  });
  assert.equal((await dockerSnapshot(project)).enabled, false);
  await assert.rejects(
    dockerAction(project, { action: "start", context: "default", containerId: id }),
    /Включите Docker/,
  );
  await assert.rejects(configureDocker({ enabled: true, context: "remote" }), /локальный/);
  await configureDocker({ enabled: true, context: "default" });
  assert.equal((await stat(join(root, "data/projector/integrations.json"))).mode & 0o777, 0o600);
  const binding = {
    context: "default",
    name: "fixture",
    files: ["compose.yaml", "override.yaml"],
    profiles: ["dev"],
    envFiles: [".env.local"],
  };
  await bindDocker(project.id, directory, binding);
  assert.deepEqual((await dockerSnapshot(project)).binding, binding);
  await assert.rejects(
    bindDocker(project.id, directory, { ...binding, files: ["../outside.yaml"] }),
    /внутри/,
  );
  await assert.rejects(
    bindDocker(project.id, directory, { ...binding, files: ["escape.yaml"] }),
    /внутри/,
  );
  await assert.rejects(
    bindDocker(project.id, directory, { ...binding, profiles: ["--help"] }),
    /profile/,
  );
  const snapshot = await dockerSnapshot(project);
  assert.equal(snapshot.connected, true);
  assert.equal(snapshot.containers[0].health, "healthy");
  assert.equal(snapshot.containers[0].ports[0].url, "http://127.0.0.1:43210");
  assert.equal(snapshot.containers[0].ports[1].url, "http://[::1]:43211");
  assert.ok(!JSON.stringify(snapshot).includes("never-return"));
  process.env.PROJECTOR_TEST_DOCKER_DOWN = "1";
  const down = await dockerSnapshot(project);
  assert.equal(down.connected, false);
  assert.equal(down.containers.length, 0);
  assert.match(down.error, /Cannot connect/);
  delete process.env.PROJECTOR_TEST_DOCKER_DOWN;
  await assert.rejects(
    dockerAction(project, { action: "down", context: "default" }),
    /Подтвердите/,
  );
  await assert.rejects(
    dockerAction(project, { action: "remove", context: "default", containerId: id, confirm: true }),
    /Сначала остановите/,
  );
  await assert.rejects(
    dockerAction(project, { action: "shell", context: "default", containerId: "--help" }),
    /containerId/,
  );
  await assert.rejects(
    dockerAction(project, {
      action: "shell",
      context: "default",
      containerId: id,
      shell: "sh; touch /tmp/bad",
    }),
    /shell/,
  );
  assert.match((await dockerLogs("default", id)).text, /FIXTURE_LOG/);
  const build = await dockerAction(project, { action: "build", context: "default" });
  await assert.rejects(dockerAction(project, { action: "up", context: "default" }), /Дождитесь/);
  await bindDocker("other-project", directory, binding);
  await assert.rejects(
    dockerAction({ ...project, id: "other-project" }, { action: "up", context: "default" }),
    /Дождитесь/,
  );
  assert.equal((await waitExit(build.session)).exitCode, 0);
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
  assert.equal((await waitExit(shell.session)).exitCode, 7);
  assert.match(output.join(""), /INPUT:hello Docker/);
  await assert.rejects(
    resolveTerminalFile(project, shell.session.id, "/etc/passwd"),
    /не сопоставлены/,
  );
  const noOrigin = await fetch(`${url}/api/docker/settings`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled: false, context: "default" }),
  });
  assert.equal(noOrigin.status, 403);
  const restarted = await fetch(`${url}/api/projects/${project.id}/terminals/${shell.session.id}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: url },
    body: JSON.stringify({ action: "restart" }),
  });
  assert.equal(restarted.status, 409);
  const records = (await readFile(trace, "utf8")).trim().split("\n").map(JSON.parse);
  assert.ok(records.every((item) => !item.host && !item.context));
  const buildArgs = records.find((item) => item.args.includes("build")).args;
  assert.deepEqual(buildArgs.slice(0, 3), ["--context", "default", "compose"]);
  assert.ok(buildArgs.includes(join(directory, "override.yaml")));
  assert.ok(buildArgs.includes(join(directory, ".env.local")));
  assert.ok(!buildArgs.includes("--volumes"));
  await bindDocker(project.id, directory, { binding: null });
  assert.equal((await dockerSnapshot(project)).binding, null);
  // Disabling must remain possible even after Docker CLI was uninstalled.
  await rm(join(bin, "docker"));
  await configureDocker({ enabled: false, context: "default" });
  assert.equal((await dockerSnapshot(project)).enabled, false);
});
