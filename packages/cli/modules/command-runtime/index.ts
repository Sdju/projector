import type { Project } from "@projector/core/modules/project/index.ts";
import type { HealthInfo, ProjectorApi, RuntimeResponse } from "../api/index.ts";

export interface ProjectRunResult {
  project: Pick<Project, "id" | "name" | "path">;
  runtime: RuntimeResponse["runtime"];
}

const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

export function serverLine(info: HealthInfo): string {
  const network = info.network?.mode === "lan" ? "lan" : "local";
  return `pid ${info.pid} · режим ${info.mode ?? "dev"} · сеть ${network}`;
}

export async function waitForHealth(
  api: ProjectorApi,
  predicate: (info: HealthInfo) => boolean,
  timeoutMs: number,
  message: string,
): Promise<HealthInfo> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const info = await api.health();
    if (info && predicate(info)) return info;
    await sleep(250);
  }
  throw new Error(message);
}

export async function waitUntilDown(
  api: ProjectorApi,
  timeoutMs: number,
  message: string,
): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (!(await api.health())) return;
    await sleep(250);
  }
  throw new Error(message);
}
