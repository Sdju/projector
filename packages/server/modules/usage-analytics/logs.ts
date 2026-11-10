import { existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import type { UsageSource } from "@ai-projector/core/modules/usage-analytics/index.ts";
import { usageLogReaders } from "../usage-log/index.ts";
import {
  forgetUsageFile,
  markUsageFileError,
  usageFile,
  usageFilePaths,
  usageLogStats,
  writeUsageFile,
  writeUsageSources,
} from "./log-store.ts";
import { rebuildUsageDays } from "./log-days.ts";
import { compactAnalyticsStore } from "./store.ts";

/** Journals older than the widest analytics range cannot contribute; a year of slack is enough. */
const STALE_MS = 366 * 86400000;
/** A journal bigger than this is more likely a copied database than a session log. */
const MAX_BYTES = 128 * 1024 * 1024;
/** Several analytics requests in a row should share one scan. */
const THROTTLE_MS = 5000;

let scan: Promise<void> | null = null;
let scanningSince = 0;
let lastRun = 0;
let lastSince = 0;

async function statuses(
  agent: string,
  label: string,
  discovered: number,
  rootsExist: boolean,
  errors: number,
  errorMessage: string | null,
  stats: ReturnType<typeof usageLogStats>,
) {
  const agentStats = stats.get(agent);
  const events = agentStats?.events ?? 0;
  const message = errorMessage ?? undefined;
  let status: UsageSource["status"] = "ok";
  if (!rootsExist) status = "unavailable";
  else if (errors > 0) status = "error";
  else if (discovered === 0 || events === 0) status = "empty";
  return {
    agent,
    label,
    status,
    files: rootsExist ? discovered : 0,
    events,
    recordedEvents: agentStats?.recorded ?? 0,
    unpricedEvents: agentStats?.unpriced ?? 0,
    lastReadAt: agentStats?.readAt ?? null,
    ...(status === "unavailable"
      ? { message: "журналы не найдены" }
      : status === "error"
        ? {
            message:
              errors === 1
                ? `не прочитан 1 файл${message ? `: ${message}` : ""}`
                : `не прочитано файлов: ${errors}`,
          }
        : status === "empty"
          ? { message: "в журналах нет событий за период" }
          : {}),
  } satisfies UsageSource;
}

/** Scans one reader, reading only files whose size or mtime changed since the last pass. */
async function scanReader(
  reader: ReturnType<typeof usageLogReaders>[number],
  since: number,
  now: number,
): Promise<{
  discovered: number;
  rootsExist: boolean;
  error?: string;
  errors?: number;
  errorMessage?: string | null;
}> {
  const roots = reader.roots();
  const rootsExist = roots.some((root) => existsSync(root));
  let files: string[] = [];
  let errors = 0;
  let errorMessage: string | null = null;
  try {
    files = [...new Set(await reader.files())];
  } catch (error) {
    return {
      discovered: 0,
      rootsExist,
      error: `не удалось прочитать каталог: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  const known = new Set(usageFilePaths(reader.agent));
  for (const file of files) {
    known.delete(file);
    let info;
    try {
      info = await stat(file);
    } catch {
      continue;
    }
    if (!info.isFile()) continue;
    // A session that stopped before the selected range cannot add to it; do not read its journal.
    if (info.mtimeMs < Math.max(since - 86400000, now - STALE_MS)) continue;
    const cursor = usageFile(file);
    const append = reader.append?.(file) ?? false;
    // An incremental cursor from an older build has no state yet, so its file is read once more.
    const complete = !append || Boolean(cursor?.state);
    if (
      cursor &&
      complete &&
      cursor.mtime === info.mtimeMs &&
      cursor.size === info.size &&
      !cursor.error
    )
      continue;
    if (info.size > (reader.maxBytes ?? MAX_BYTES)) {
      markUsageFileError(
        file,
        reader.agent,
        { mtime: info.mtimeMs, size: info.size },
        "файл слишком велик",
        now,
      );
      errors += 1;
      errorMessage = "файл слишком велик";
      continue;
    }
    try {
      const result = await reader.read(file, cursor?.state ?? undefined);
      const events = Array.isArray(result) ? result : result.events;
      const state = Array.isArray(result) ? undefined : result.state;
      writeUsageFile(file, reader.agent, { mtime: info.mtimeMs, size: info.size }, events, now, {
        append,
        ...(state !== undefined ? { state } : {}),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      markUsageFileError(
        file,
        reader.agent,
        { mtime: info.mtimeMs, size: info.size },
        message,
        now,
      );
      errors += 1;
      errorMessage = message;
    }
  }
  for (const path of known) {
    // A vanished journal must not keep contributing events that nobody can verify anymore.
    if (!existsSync(path)) forgetUsageFile(path);
  }
  return { discovered: files.length, rootsExist, errors, errorMessage };
}

async function run(since: number, now: number): Promise<void> {
  const results: Array<{
    reader: ReturnType<typeof usageLogReaders>[number];
    discovered: number;
    rootsExist: boolean;
    error?: string;
    errors?: number;
    errorMessage?: string | null;
  }> = [];
  for (const reader of usageLogReaders()) {
    let result: {
      discovered: number;
      rootsExist: boolean;
      error?: string;
      errors?: number;
      errorMessage?: string | null;
    } = {
      discovered: 0,
      rootsExist: false,
    };
    try {
      result = await scanReader(reader, since, now);
    } catch (error) {
      result = {
        discovered: 0,
        rootsExist: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
    results.push({ reader, ...result });
  }

  // Stats are read after the scan: a first look at a new journal must not report "empty".
  const stats = usageLogStats();
  const sources: UsageSource[] = [];
  for (const item of results) {
    const { reader } = item;
    if (item.error) {
      sources.push({
        agent: reader.agent,
        label: reader.label,
        status: "error",
        files: item.discovered,
        events: 0,
        recordedEvents: 0,
        unpricedEvents: 0,
        lastReadAt: null,
        message: item.error,
      });
      continue;
    }
    sources.push(
      await statuses(
        reader.agent,
        reader.label,
        item.discovered,
        item.rootsExist,
        item.errors ?? 0,
        item.errorMessage ?? null,
        stats,
      ),
    );
  }
  if (sources.length) writeUsageSources(sources);
  rebuildUsageDays();
  compactAnalyticsStore(now);
}

/**
 * Brings the native journal store up to date. The first scan reads only sessions that could touch
 * the selected range; later scans read changed files only, so opening analytics is not a rescan.
 */
export async function refreshUsageLogs(
  since: number,
  now = Date.now(),
  force = false,
): Promise<void> {
  // A wider range needs files the previous scan skipped on purpose, so it is not throttled.
  const wider = since < lastSince;
  if (!force && !wider && now - lastRun < THROTTLE_MS) return;
  if (scan) {
    await scan;
    // A scan for a narrower range does not cover this request; start one for the wider range.
    if (since >= scanningSince) return;
  }
  if (scan) return scan;
  scanningSince = since;
  scan = run(since, now).finally(() => {
    scan = null;
    lastRun = Date.now();
    lastSince = since;
  });
  return scan;
}

/** Test hook: forgets the scan throttle so fixtures can change between cases. */
export function resetUsageLogScan(): void {
  lastRun = 0;
  lastSince = 0;
  scanningSince = 0;
}
