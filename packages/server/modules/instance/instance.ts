import { readFileSync, unlinkSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { appPort, appUrl, instancePath } from "@ai-projector/core/modules/app-paths/index.ts";
import { writeFileAtomic } from "../atomic-files/index.ts";

export interface InstanceInfo {
  pid: number;
  port: number;
  url: string;
  startedAt: string;
}

export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function writeInstance(port = appPort()): Promise<void> {
  const file = instancePath();
  const info: InstanceInfo = {
    pid: process.pid,
    port,
    url: appUrl(port),
    startedAt: new Date().toISOString(),
  };
  await writeFileAtomic(file, `${JSON.stringify(info, null, 2)}\n`);
}

export async function readInstance(): Promise<InstanceInfo | null> {
  try {
    const info = JSON.parse(await readFile(instancePath(), "utf8")) as InstanceInfo;
    if (!info.pid || !isPidAlive(info.pid)) {
      await clearInstance();
      return null;
    }
    return info;
  } catch {
    return null;
  }
}

/** Also runs during process exit, when asynchronous filesystem work cannot complete. */
export function clearInstance(): void {
  try {
    const file = instancePath();
    const info = JSON.parse(readFileSync(file, "utf8")) as InstanceInfo;
    if (info.pid && info.pid !== process.pid) return;
    unlinkSync(file);
  } catch {
    // Missing, malformed or already removed by another shutdown hook.
  }
}
