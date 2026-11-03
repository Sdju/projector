import { existsSync } from "node:fs";
import { join } from "node:path";
import type { DockerStartPlan } from "../../contract.ts";

/** Docker Desktop is the only Windows daemon Projector can start. */
export function dockerStartPlan(): DockerStartPlan {
  const bases = [process.env.ProgramFiles, process.env.ProgramW6432, "C:\\Program Files"];
  for (const base of bases) {
    if (!base) continue;
    const exe = join(base, "Docker", "Docker", "Docker Desktop.exe");
    if (existsSync(exe)) return { label: "Запустить Docker Desktop", command: exe, args: [] };
  }
  return {
    label: "Docker Desktop не найден",
    manual:
      "Установите Docker Desktop: https://docs.docker.com/desktop/setup/install/windows-install/",
  };
}
