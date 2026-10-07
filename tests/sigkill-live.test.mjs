import { expect, test } from "vite-plus/test";
import { execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { setTimeout as sleep } from "node:timers/promises";

// Kills a real server process and starts another one; needs Docker, dist/ and opt-in.
const enabled = process.env.PROJECTOR_TEST_DOCKER === "1" && existsSync("dist/index.html");
const docker = (...args) => execFileSync("docker", args, { encoding: "utf8" }).trim();
const until = async (check, what) => {
  for (let i = 0; i < 120; i++) {
    if (await check()) return;
    await sleep(250);
  }
  expect.unreachable(`timed out waiting for ${what}`);
};

test(
  "a container orphaned by SIGKILL is removed by the next server",
  { skip: !enabled },
  async () => {
    const root = await mkdtemp(join(tmpdir(), "projector-sigkill-"));
    const data = join(root, "data");
    const path = join(root, "proj");
    const id = "33333333-3333-4333-8333-333333333333";
    const count = () =>
      docker("ps", "-aq", "--filter", `label=io.projector.environment=${id}`)
        .split("\n")
        .filter(Boolean).length;
    await mkdir(join(data, "projector"), { recursive: true });
    await mkdir(path);
    const project = {
      id,
      name: "sigkill-probe",
      path,
      url: "",
      icon: "",
      mode: "server",
      defaultCommandId: "c",
      commands: [{ id: "c", name: "shell", cmd: "bash" }],
      createdAt: "2026-10-04T00:00:00Z",
      environment: {
        kind: "docker",
        context: "default",
        image: "node:24-bookworm",
        network: "none",
        ports: [],
      },
    };
    await writeFile(
      join(data, "projector", "projects.json"),
      JSON.stringify({ projects: [project] }),
    );
    const env = { ...process.env, XDG_DATA_HOME: data };
    // "Server A" starts a long non-interactive command (like the agent's Bash tool) and never gets to clean up.
    const first = spawn(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `
    const { environmentLaunch } = await import(${JSON.stringify(new URL("../server/modules/environments/index.ts", import.meta.url).href)});
    const { spawn } = await import("node:child_process");
    const launch = environmentLaunch(${JSON.stringify(project)}, ["/bin/bash", "-c", "sleep 300"], false);
    spawn(launch.file, launch.args, { stdio: "ignore" });
    setInterval(() => {}, 1000);
  `,
      ],
      { env, stdio: "ignore" },
    );
    let second;
    try {
      await until(() => count() === 1, "the container to start");
      first.kill("SIGKILL");
      await sleep(1500);
      expect(count(), "the orphan survives the killed server").toBe(1);
      let log = "";
      second = spawn(process.execPath, ["server/app/standalone.ts"], {
        env: { ...env, PROJECTOR_PORT: "4393" },
        stdio: ["ignore", "pipe", "pipe"],
      });
      second.stdout.on("data", (chunk) => (log += chunk));
      await until(() => count() === 0, "the next server to remove the orphan");
      expect(log).toMatch(/Удалено контейнеров от прошлого запуска Projector: 1/);
    } finally {
      first.kill("SIGKILL");
      second?.kill("SIGTERM");
      const ids = docker("ps", "-aq", "--filter", `label=io.projector.environment=${id}`)
        .split("\n")
        .filter(Boolean);
      if (ids.length) docker("rm", "-f", ...ids);
      await rm(root, { recursive: true, force: true });
    }
  },
);
