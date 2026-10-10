import { watch, type FSWatcher } from "node:fs";
import { realpath } from "node:fs/promises";
import { posix, resolve } from "node:path";

import { broadcastEvent, onEventClientClose } from "../events/index.ts";
import { pathExcluded, validatePath, within } from "./paths.ts";

interface Directory {
  projectId: string;
  /** Project-relative directory ("" for the root). */
  directory: string;
  watcher: FSWatcher;
  /** Project-relative paths of the open files in this directory. */
  files: Set<string>;
  /** The folder is expanded in a file tree: any entry change matters. */
  listed: boolean;
  timers: Map<string, NodeJS.Timeout>;
}

interface Subscription {
  root: string;
  paths: Set<string>;
  directories: Set<string>;
}

interface Registry {
  /** Per page: project → what the page shows. */
  clients: Map<string, Map<string, Subscription>>;
  directories: Map<string, Directory>;
  bound: boolean;
}

// Vite reloads the API modules without closing watchers: keep them across reloads.
const host = globalThis as typeof globalThis & { projectorFileWatch?: Registry };
const registry = (host.projectorFileWatch ??= {
  clients: new Map(),
  directories: new Map(),
  bound: false,
});
const DEBOUNCE_MS = 60;
const LISTING_DEBOUNCE_MS = 150;
const MAX_FILES = 200;
const MAX_DIRECTORIES = 300;

function closeDirectory(key: string) {
  const entry = registry.directories.get(key);
  if (!entry) return;
  registry.directories.delete(key);
  entry.watcher.close();
  for (const timer of entry.timers.values()) clearTimeout(timer);
}

function schedule(entry: Directory, id: string, delay: number, send: () => void) {
  clearTimeout(entry.timers.get(id));
  entry.timers.set(
    id,
    setTimeout(() => {
      entry.timers.delete(id);
      send();
    }, delay),
  );
}

function changed(entry: Directory, name: string | undefined) {
  const fileChanged = (path: string) =>
    schedule(entry, `f:${path}`, DEBOUNCE_MS, () =>
      broadcastEvent("file-changed", { projectId: entry.projectId, path }),
    );
  if (entry.listed)
    schedule(entry, "d", LISTING_DEBOUNCE_MS, () =>
      broadcastEvent("dir-changed", { projectId: entry.projectId, directory: entry.directory }),
    );
  if (name === undefined) return void entry.files.forEach(fileChanged);
  const path = posix.join(entry.directory, name);
  if (entry.files.has(path)) fileChanged(path);
}

/** Running out of inotify watches is the one failure the user can fix: tell the pages. */
function reportFailure(projectId: string, error: unknown) {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  if (code === "ENOSPC" || code === "EMFILE")
    broadcastEvent("watch-error", {
      projectId,
      message:
        "Не удалось следить за файлами: исчерпан лимит наблюдателей ОС (fs.inotify.max_user_watches)",
    });
}

/** Opens the directory watchers that the pages need and closes the ones nobody needs. */
async function reconcile() {
  const wanted = new Map<
    string,
    { projectId: string; root: string; directory: string; files: Set<string>; listed: boolean }
  >();
  const want = (projectId: string, root: string, directory: string) => {
    const key = `${projectId}\0${directory}`;
    const item = wanted.get(key) ?? {
      projectId,
      root,
      directory,
      files: new Set<string>(),
      listed: false,
    };
    wanted.set(key, item);
    return item;
  };
  for (const projects of registry.clients.values())
    for (const [projectId, { root, paths, directories }] of projects) {
      for (const path of paths) {
        const directory = posix.dirname(path) === "." ? "" : posix.dirname(path);
        want(projectId, root, directory).files.add(path);
      }
      for (const directory of directories) want(projectId, root, directory).listed = true;
    }
  for (const key of [...registry.directories.keys()]) if (!wanted.has(key)) closeDirectory(key);
  for (const [key, item] of wanted) {
    const current = registry.directories.get(key);
    if (current) {
      current.files = item.files;
      current.listed = item.listed;
      continue;
    }
    try {
      const base = await realpath(item.root);
      const full = await realpath(resolve(base, item.directory));
      if (!within(base, full) && full !== base) continue;
      const entry: Directory = {
        projectId: item.projectId,
        directory: item.directory,
        files: item.files,
        listed: item.listed,
        timers: new Map(),
        watcher: watch(full, { persistent: false }, (_type, name) => {
          const file = name ? String(name) : undefined;
          // Own temporary files of atomic saves, and everything the project hides.
          if (file?.startsWith(".projector-")) return;
          if (file && entry.listed && !entry.files.has(posix.join(entry.directory, file)))
            void pathExcluded(posix.join(entry.directory, file)).then(
              (hidden) => hidden || changed(entry, file),
              () => changed(entry, file),
            );
          else changed(entry, file);
        }),
      };
      entry.watcher.on("error", (error) => {
        closeDirectory(key);
        reportFailure(item.projectId, error);
      });
      registry.directories.set(key, entry);
    } catch (error) {
      // The folder is gone or unreadable: the page learns about it when it re-reads the listing.
      reportFailure(item.projectId, error);
    }
  }
}

function checked(values: unknown[], limit: number, allowRoot: boolean) {
  const result = new Set<string>();
  for (const value of values.slice(0, limit)) {
    if (typeof value !== "string" || value.includes("\\")) continue;
    if (allowRoot && value === "") result.add(value);
    else if (value) {
      validatePath(value);
      result.add(value);
    }
  }
  return result;
}

/**
 * Replaces what a page shows in a project: the open files (`paths`) and the folders expanded
 * in the tree (`directories`); a field that is left out stays as it was.
 * The pages get `file-changed` and `dir-changed` events.
 */
export async function watchProject(
  clientId: string,
  projectId: string,
  root: string,
  patch: { paths?: unknown[]; directories?: unknown[] },
) {
  if (!registry.bound) {
    registry.bound = true;
    onEventClientClose((id) => {
      registry.clients.delete(id);
      void reconcile();
    });
  }
  const projects = registry.clients.get(clientId) ?? new Map<string, Subscription>();
  const current = projects.get(projectId) ?? {
    root,
    paths: new Set<string>(),
    directories: new Set<string>(),
  };
  if (patch.paths) current.paths = checked(patch.paths, MAX_FILES, false);
  if (patch.directories) current.directories = checked(patch.directories, MAX_DIRECTORIES, true);
  if (current.paths.size || current.directories.size) projects.set(projectId, current);
  else projects.delete(projectId);
  if (projects.size) registry.clients.set(clientId, projects);
  else registry.clients.delete(clientId);
  await reconcile();
}
