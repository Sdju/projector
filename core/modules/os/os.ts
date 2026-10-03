import { homedir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import * as linux from "./modules/linux/index.ts";
import type { DesktopAction, ResidentOptions } from "./contract.ts";

export class UnsupportedPlatformError extends Error {
  readonly code = "ERR_OS_UNSUPPORTED";
  constructor(platform: string, operation: string) {
    super(`Операция ${operation} не поддерживается на ОС ${platform}`);
    this.name = "UnsupportedPlatformError";
  }
}

/** OS selection happens once; user environment/settings are read when needed. */
export function createOs(platform: NodeJS.Platform = process.platform) {
  const supported = platform === "linux";
  const backend = (operation: string) => {
    if (!supported) throw new UnsupportedPlatformError(platform, operation);
    return linux;
  };
  const adapter = {
    platform,
    supported,
    capabilities: Object.freeze({
      nativeDesktop: supported,
      processInspection: supported,
      fileOperations: supported,
    }),
    homeDirectory: homedir,
    dataHome: () => backend("dataHome").dataHome(),
    shell: () => backend("shell").shell(),
    installDesktop: (root: string) => backend("installDesktop").installDesktop(root),
    desktopPaths: () => backend("desktopPaths").desktopPaths(),
    requireSupported: (operation: string) => {
      backend(operation);
    },
    processes: {
      list: () => (supported ? linux.listProcesses() : null),
      signal: (pid: number, signal: NodeJS.Signals) =>
        backend("processes.signal").signalProcess(pid, signal),
      descendants: (pid: number) => backend("processes.descendants").descendants(pid),
      identity: (pid: number) => backend("processes.identity").processIdentity(pid),
      workingDirectory: (pid: number, fallback: string) =>
        backend("processes.workingDirectory").workingDirectory(pid, fallback),
      async waitForExit(pid: number, timeoutMs = 15000) {
        const identity = adapter.processes.identity(pid);
        if (identity === null) return;
        const deadline = Date.now() + timeoutMs;
        while (adapter.processes.identity(pid) === identity) {
          if (Date.now() >= deadline) throw new Error(`Процесс ${pid} не завершился`);
          await sleep(50);
        }
      },
    },
    tools: {
      runBash: (command: string, options: { cwd: string; signal?: AbortSignal }) =>
        backend("runBash").runBash(command, options),
      moveNoReplace: (source: string, target: string) =>
        backend("moveNoReplace").moveNoReplace(source, target),
      runPython: (
        helper: string,
        args: string[],
        options: { timeout: number; maxBuffer: number },
      ) => backend("runPython").runPython(helper, args, options),
      searchFiles: (args: string[], options: { cwd: string; timeout: number; maxBuffer: number }) =>
        backend("searchFiles").searchFiles(args, options),
    },
    windows: {
      focusApp: (appClass: string) => backend("focusApp").focusAppWindow(appClass),
      open: (url: string) => backend("openWindow").openWindow(url),
      openBrowser: (url: string) => backend("openBrowser").openBrowser(url),
      openOrFocusApp: (url: string, appClass: string, profile: string) =>
        backend("openOrFocusApp").openOrFocusApp(url, appClass, profile),
      hidePalette: (appClass: string) => backend("hidePalette").hidePalette(appClass),
      openPalette: (url: string, toggle: boolean, appClass: string, profile: string) =>
        backend("openPalette").openWebPalette(url, toggle, appClass, profile),
      closePalette: (appClass: string) => backend("closePalette").closePalette(appClass),
      activate: (id: number | bigint) => backend("activateWindow").activateWindow(id),
    },
    pickFolder: () => backend("pickFolder").pickFolder(),
    catalog: () => backend("catalog").catalog(),
    async runDesktop(url: string, action: DesktopAction, options: ResidentOptions) {
      const { runResident } = await backend("runDesktop").resident();
      return runResident(url, action, options);
    },
    desktopPid: (service: string) =>
      supported ? linux.desktopPid(service) : Promise.resolve(undefined),
    shortcutStatus: () =>
      supported
        ? linux.shortcutStatus()
        : Promise.resolve({ supported: false, active: false, shortcut: "" }),
    shortcutAvailable: (shortcut: string) =>
      supported
        ? linux.shortcutAvailable(shortcut)
        : Promise.resolve({ supported: false, available: false }),
    toolchainBin: () => join(homedir(), ".vite-plus/bin"),
  };
  return Object.freeze(adapter);
}
export const os = createOs();

export type OsAdapter = ReturnType<typeof createOs>;
