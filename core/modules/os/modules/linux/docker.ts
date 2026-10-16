import { execFileSync } from "node:child_process";
import type { DockerStartPlan } from "../../contract.ts";
import { commandExists } from "../../../os-posix/index.ts";

function unitExists(unit: string): boolean {
  try {
    execFileSync("systemctl", ["--user", "cat", unit], { stdio: "ignore", timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

/** Rootless Docker and Docker Desktop are user units; the system daemon needs root rights. */
export function dockerStartPlan(): DockerStartPlan {
  if (!commandExists("docker"))
    return {
      label: "Docker не установлен",
      manual: "Установите Docker Engine: https://docs.docker.com/engine/install/",
    };
  if (!commandExists("systemctl"))
    return {
      label: "Запустить daemon",
      manual: "Запустите daemon вручную: sudo service docker start",
    };
  if (unitExists("docker.service"))
    return {
      label: "systemctl --user start docker",
      command: "systemctl",
      args: ["--user", "start", "docker"],
    };
  if (unitExists("docker-desktop.service"))
    return {
      label: "systemctl --user start docker-desktop",
      command: "systemctl",
      args: ["--user", "start", "docker-desktop"],
    };
  if (process.getuid?.() === 0)
    return { label: "systemctl start docker", command: "systemctl", args: ["start", "docker"] };
  if (commandExists("pkexec"))
    return {
      label: "systemctl start docker (запросит пароль)",
      command: "pkexec",
      args: ["systemctl", "start", "docker"],
    };
  return {
    label: "Запустить daemon",
    manual: "Выполните в терминале: sudo systemctl start docker",
  };
}
