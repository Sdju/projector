import { expect, test } from "vite-plus/test";
import { spawn, execFileSync } from "node:child_process";
import { access, mkdtemp, realpath, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { setTimeout as sleep } from "node:timers/promises";
import {
  environmentLaunch,
  environmentPorts,
  runEnvironmentCommand,
  stopEnvironmentContainer,
} from "../server/modules/environments/index.ts";

// Needs a local Docker daemon and the default image; opt-in.
const enabled = process.env.PROJECTOR_TEST_DOCKER === "1";
const exists = (path) =>
  access(path).then(
    () => true,
    () => false,
  );
const docker = (...args) => execFileSync("docker", args, { encoding: "utf8" }).trim();
const bash = (command) => ["/bin/bash", "--noprofile", "--norc", "-c", command];

const folders = [];
async function project(name, environment) {
  const path = await realpath(await mkdtemp(join(tmpdir(), `projector-env-${name}-`)));
  folders.push(path);
  return {
    id: name,
    name,
    path,
    url: "",
    icon: "",
    mode: "server",
    commands: [],
    defaultCommandId: "",
    createdAt: "",
    environment: {
      kind: "docker",
      context: "default",
      image: "node:24-bookworm",
      network: "none",
      ports: [],
      ...environment,
    },
  };
}
const output = async (item, command) =>
  (await runEnvironmentCommand(item, bash(command), 60_000)).stdout;
const failing = (item, command) => runEnvironmentCommand(item, bash(command), 60_000);

test(
  "the container is unprivileged, offline and sees nothing of the host",
  { skip: !enabled },
  async () => {
    process.env.PROJECTOR_LIVE_SECRET_TOKEN = "must-not-leak";
    const item = await project("isolation");
    const uid = process.getuid();
    expect((await output(item, "id -u")).trim()).toBe(String(uid));
    expect(
      !(await output(item, "env")).includes("must-not-leak"),
      "host secrets are not passed",
    ).toBeTruthy();
    await expect(failing(item, "ls /var/run/docker.sock"), "no Docker socket").rejects.toThrow();
    await expect(
      failing(item, "touch /etc/projector-probe"),
      "rootfs is read-only",
    ).rejects.toThrow();
    expect(
      (await output(item, "ls -A /home/node | wc -l")).trim(),
      "HOME is empty and temporary",
    ).toBe("0");
    expect((await output(item, "ls /home | tr '\\n' ' '")).trim(), "no host home").toBe("node");
    await expect(
      failing(item, "timeout 3 bash -c 'echo > /dev/tcp/1.1.1.1/53'"),
      "no network",
    ).rejects.toThrow();
    expect(
      (
        await output(
          item,
          "grep -c CapEff /proc/self/status; grep CapEff /proc/self/status | tr -d ' \\t'",
        )
      ).includes("CapEff:0000000000000000"),
      "no capabilities",
    ).toBe(true);
    await output(item, "echo kept > /workspace/probe.txt");
    const written = await stat(join(item.path, "probe.txt"));
    expect(written.uid, "files written to the project belong to the host user").toBe(uid);
  },
);

test(
  "a broken daemon context never falls back to running on the host",
  { skip: !enabled },
  async () => {
    const item = await project("nofallback", { context: "projector-nonexistent-context" });
    const marker = join(item.path, "ran-on-host");
    await expect(runEnvironmentCommand(item, bash(`touch ${marker}`), 20_000)).rejects.toThrow();
    expect(await exists(marker)).toBe(false);
  },
);

test(
  "two projects can serve the same container port on separate loopback ports",
  { skip: !enabled },
  async () => {
    const a = await project("port-a", { network: "bridge", ports: [3000] });
    const b = await project("port-b", { network: "bridge", ports: [3000] });
    const server =
      "require('http').createServer((q,r)=>r.end(process.env.WHO||'ok')).listen(3000,'0.0.0.0')";
    const started = [];
    try {
      for (const item of [a, b]) {
        const launch = environmentLaunch(item, ["node", "-e", server], false);
        const client = spawn(launch.file, launch.args, { stdio: "ignore" });
        started.push({ item, name: launch.docker.containerId, client });
      }
      const ports = [];
      for (const { name } of started) {
        let found = [];
        for (let i = 0; i < 100 && !found.length; i++) {
          found = await environmentPorts("default", name).catch(() => []);
          if (!found.length) await sleep(200);
        }
        expect(found.length, "port published").toBe(1);
        ports.push(found[0]);
      }
      expect(ports[0].url).not.toBe(ports[1].url);
      for (const port of ports) {
        expect(port.url, "bound to loopback only").toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
        for (let i = 0; ; i++) {
          const response = await fetch(port.url).catch(() => undefined);
          if (response?.ok) break;
          expect(i < 50, `service answered at ${port.url}`).toBeTruthy();
          await sleep(200);
        }
      }
    } finally {
      for (const { name, client } of started) {
        client.kill("SIGKILL");
        await stopEnvironmentContainer("default", name, true);
      }
    }
    for (const { name } of started)
      expect(docker("ps", "-aq", "--filter", `name=^${name}$`), "container removed").toBe("");
  },
);

test(
  "stopping while Docker is still creating the container leaves nothing behind",
  { skip: !enabled },
  async () => {
    const item = await project("racing");
    const launch = environmentLaunch(item, ["sleep", "60"], false);
    const client = spawn(launch.file, launch.args, { stdio: "ignore" });
    // Stop immediately, before the container necessarily exists.
    client.kill("SIGKILL");
    await stopEnvironmentContainer("default", launch.docker.containerId, true);
    await sleep(1500);
    expect(docker("ps", "-aq", "--filter", `name=^${launch.docker.containerId}$`)).toBe("");
  },
);

test("temporary project folders are removed", { skip: !enabled }, async () => {
  for (const folder of folders) await rm(folder, { recursive: true, force: true });
});
