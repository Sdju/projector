import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { APP_PORT, appUrl, instancePath } from "./paths.ts";

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

export async function writeInstance(port = APP_PORT): Promise<void> {
  const file = instancePath();
  await mkdir(dirname(file), { recursive: true });
  const info: InstanceInfo = {
    pid: process.pid,
    port,
    url: appUrl(),
    startedAt: new Date().toISOString(),
  };
  await writeFile(file, `${JSON.stringify(info, null, 2)}\n`, "utf8");
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

export async function clearInstance(): Promise<void> {
  try {
    const raw = await readFile(instancePath(), "utf8");
    const info = JSON.parse(raw) as InstanceInfo;
    if (info.pid && info.pid !== process.pid) return;
  } catch {
    return;
  }
  await unlink(instancePath()).catch(() => undefined);
}
