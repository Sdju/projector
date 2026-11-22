import {
  isNewer,
  shouldNotifyInbox,
  shouldOfferUpdate,
  updateCommandText,
  updateCommands,
  releaseNotesUrl,
  type InstallSource,
} from "@ai-projector/core/modules/app-update/index.ts";
import { cacheIsFresh, readUpdateCache, writeUpdateCache, type UpdateCache } from "./cache.ts";
import { readInstalledApp, type InstalledApp } from "./installed.ts";
import { fetchPublishedVersions } from "./registry.ts";

export type { InstalledApp } from "./installed.ts";
export type { UpdateCache } from "./cache.ts";
export { findInstallRoot, readInstalledApp } from "./installed.ts";
export { cacheIsFresh, readUpdateCache, writeUpdateCache } from "./cache.ts";
export { fetchNpmLatest, fetchPublishedVersions } from "./registry.ts";

export interface AppUpdateSnapshot {
  version?: string;
  source: InstallSource;
  latest?: string;
  outdated: boolean;
  offer: boolean;
  inbox: boolean;
  dismissed?: string;
  checkedAt?: string;
  command?: string;
  notesUrl?: string;
  restart: boolean;
  native?: { version?: string; latest?: string; lockstep: boolean };
  hub?: { version?: string; latest?: string; lockstep: boolean };
  error?: string;
}

const runtime = globalThis as typeof globalThis & { projectorUpdateRefresh?: Promise<void> };

function lockstep(current?: string, other?: string): boolean {
  return !!current && !!other && current !== other;
}

export function appUpdateSnapshot(installed: InstalledApp, cache: UpdateCache): AppUpdateSnapshot {
  const latest = cache.latest;
  const offer = shouldOfferUpdate({
    source: installed.source,
    current: installed.version,
    latest,
  });
  return {
    version: installed.version,
    source: installed.source,
    latest,
    outdated: !!installed.version && !!latest && isNewer(latest, installed.version),
    offer,
    inbox: shouldNotifyInbox({
      source: installed.source,
      current: installed.version,
      latest,
      dismissed: cache.dismissed,
    }),
    dismissed: cache.dismissed,
    checkedAt: cache.checkedAt,
    command:
      offer && latest
        ? updateCommandText(
            updateCommands({ latest, native: !!installed.native, hub: !!installed.hub }),
          )
        : undefined,
    notesUrl: latest ? releaseNotesUrl(latest) : undefined,
    restart: true,
    native: installed.native
      ? {
          version: installed.native.version,
          latest: cache.nativeLatest,
          lockstep: lockstep(installed.version, installed.native.version),
        }
      : undefined,
    hub: installed.hub
      ? {
          version: installed.hub.version,
          latest: cache.hubLatest,
          lockstep: lockstep(installed.version, installed.hub.version),
        }
      : undefined,
  };
}

async function refreshCache(installed: InstalledApp): Promise<string | undefined> {
  try {
    const published = await fetchPublishedVersions(installed);
    const previous = await readUpdateCache();
    await writeUpdateCache({
      checkedAt: new Date().toISOString(),
      latest: published.ide.version,
      integrity: published.ide.integrity,
      nativeLatest: published.native?.version,
      hubLatest: published.hub?.version,
      dismissed: previous.dismissed,
    });
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/** Cached snapshot; a stale cache refreshes in the background and does not block. */
export async function readAppUpdate(): Promise<AppUpdateSnapshot> {
  const installed = readInstalledApp();
  const cache = await readUpdateCache();
  if (!cacheIsFresh(cache) && !runtime.projectorUpdateRefresh)
    runtime.projectorUpdateRefresh = refreshCache(installed)
      .then(() => undefined)
      .finally(() => {
        runtime.projectorUpdateRefresh = undefined;
      });
  return appUpdateSnapshot(installed, cache);
}

/** Waits for a registry check. Offline failures stay on the snapshot, they do not throw. */
export async function checkAppUpdate(): Promise<AppUpdateSnapshot> {
  const installed = readInstalledApp();
  const error = await refreshCache(installed);
  const snapshot = appUpdateSnapshot(installed, await readUpdateCache());
  if (error) snapshot.error = error;
  return snapshot;
}

export async function dismissAppUpdate(version?: string): Promise<AppUpdateSnapshot> {
  const cache = await readUpdateCache();
  const latest = version?.trim() || cache.latest;
  if (latest) await writeUpdateCache({ ...cache, dismissed: latest });
  return readAppUpdate();
}

/** Startup: refresh when the cache is empty or older than the Codex-like 20h window. */
export function scheduleAppUpdateCheck(): void {
  void readAppUpdate().catch((error) => {
    console.warn("Проверка обновления Projector:", error instanceof Error ? error.message : error);
  });
}
