import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { dataDir } from "@ai-projector/core/modules/app-paths/index.ts";
import { UPDATE_CACHE_HOURS } from "@ai-projector/core/modules/app-update/index.ts";
import { writeFileAtomic } from "../atomic-files/index.ts";

export interface UpdateCache {
  checkedAt?: string;
  latest?: string;
  dismissed?: string;
  integrity?: string;
  nativeLatest?: string;
  hubLatest?: string;
}

const cacheFile = () => join(dataDir(), "update.json");

export async function readUpdateCache(): Promise<UpdateCache> {
  try {
    const value: unknown = JSON.parse(await readFile(cacheFile(), "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    const record = value as Record<string, unknown>;
    const text = (key: string) => (typeof record[key] === "string" ? record[key] : undefined);
    return {
      checkedAt: text("checkedAt"),
      latest: text("latest"),
      dismissed: text("dismissed"),
      integrity: text("integrity"),
      nativeLatest: text("nativeLatest"),
      hubLatest: text("hubLatest"),
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    return {};
  }
}

export async function writeUpdateCache(cache: UpdateCache): Promise<void> {
  await writeFileAtomic(cacheFile(), `${JSON.stringify(cache, null, 2)}\n`);
}

export function cacheIsFresh(cache: UpdateCache, now = Date.now()): boolean {
  if (!cache.checkedAt || !cache.latest) return false;
  const checked = Date.parse(cache.checkedAt);
  if (!Number.isFinite(checked)) return false;
  return now - checked < UPDATE_CACHE_HOURS * 60 * 60 * 1000;
}
