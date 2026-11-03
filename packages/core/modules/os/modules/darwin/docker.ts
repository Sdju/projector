import { existsSync } from "node:fs";
import type { DockerStartPlan } from "../../contract.ts";
import { commandExists } from "../../../os-posix/index.ts";

/** Docker Desktop, OrbStack and Colima each bring up their own VM with the daemon. */
export function dockerStartPlan(): DockerStartPlan {
  if (existsSync("/Applications/Docker.app"))
    return { label: "Запустить Docker Desktop", command: "open", args: ["-ga", "Docker"] };
  if (existsSync("/Applications/OrbStack.app"))
    return { label: "Запустить OrbStack", command: "open", args: ["-ga", "OrbStack"] };
  if (commandExists("colima")) return { label: "colima start", command: "colima", args: ["start"] };
  return {
    label: "Docker не установлен",
    manual: "Установите Docker Desktop, OrbStack или Colima (brew install colima docker)",
  };
}
