import { watch, type FSWatcher } from "node:fs";
import { dataDir } from "@ai-projector/core/modules/app-paths/index.ts";

/** A burst of file writes is one discovery pass; hashing the packages is not free. */
const DELAY_MS = 400;

interface WatchHost {
  stop?: () => void;
}

const host = globalThis as typeof globalThis & { projectorPluginWatch?: WatchHost };

/**
 * Watches the plugin root and re-reads the catalog after files change. Without it a changed
 * package keeps its old trust state until the user opens the plugins page: the agent silently
 * disappears from the chat and only a diagnostic inside settings explains why. Discovery updates
 * the inbox notices and unregisters code whose trust was revoked.
 */
export function watchPluginDirectory(
  directoryPath: () => string,
  discover: () => Promise<unknown>,
): () => void {
  if (host.projectorPluginWatch?.stop) return () => undefined;

  let directory: FSWatcher | undefined;
  let parent: FSWatcher | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running = false;
  let again = false;
  let stopped = false;

  function schedule(): void {
    if (stopped || timer) return;
    timer = setTimeout(() => {
      timer = undefined;
      void scan();
    }, DELAY_MS);
    timer.unref?.();
  }

  async function scan(): Promise<void> {
    if (stopped) return;
    if (running) {
      again = true;
      return;
    }
    running = true;
    try {
      await discover();
    } catch (error) {
      console.error(
        "Плагины:",
        error instanceof Error ? error.message : "не удалось перечитать каталог",
      );
    } finally {
      running = false;
      if (!stopped && again) {
        again = false;
        schedule();
      }
    }
  }

  const watchParent = (): void => {
    if (stopped || parent) return;
    try {
      parent = watch(dataDir(), { persistent: false }, (_event, name) => {
        if (name !== "plugins") return;
        parent?.close();
        parent = undefined;
        attach();
        schedule();
      });
      parent.on("error", () => {
        parent?.close();
        parent = undefined;
      });
    } catch {
      // The data directory is created by the server before this runs; a missing one is not fatal.
    }
  };

  function attach(): void {
    if (stopped) return;
    directory?.close();
    directory = undefined;
    try {
      directory = watch(directoryPath(), { recursive: true, persistent: false }, schedule);
      directory.on("error", () => {
        directory?.close();
        directory = undefined;
        watchParent();
      });
    } catch {
      watchParent();
    }
  }

  attach();
  const stop = (): void => {
    stopped = true;
    if (timer) clearTimeout(timer);
    timer = undefined;
    directory?.close();
    parent?.close();
    directory = undefined;
    parent = undefined;
    if (host.projectorPluginWatch?.stop === stop) delete host.projectorPluginWatch;
  };
  host.projectorPluginWatch = { stop };
  return stop;
}
