import { homedir, userInfo } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import * as linux from "./modules/linux/index.ts";
import * as darwin from "./modules/darwin/index.ts";
import * as windows from "./modules/windows/index.ts";
import type {
  AgentHostSpec,
  AskpassSpec,
  AgentProcessSpec,
  DesktopAction,
  ResidentOptions,
  SecretKey,
  ShellLaunch,
} from "./contract.ts";

export class UnsupportedPlatformError extends Error {
  readonly code = "ERR_OS_UNSUPPORTED";
  constructor(platform: string, operation: string) {
    super(`Операция ${operation} не поддерживается на ОС ${platform}`);
    this.name = "UnsupportedPlatformError";
  }
}

/** OS selection happens once; user environment/settings are read when needed. */
export function createOs(platform: NodeJS.Platform = process.platform) {
  const implementation =
    platform === "linux"
      ? linux
      : platform === "win32"
        ? windows
        : platform === "darwin"
          ? darwin
          : null;
  const supported = implementation !== null;
  const nativeDesktop = platform === "linux" || platform === "win32";
  const backend = (operation: string) => {
    if (!implementation) throw new UnsupportedPlatformError(platform, operation);
    return implementation;
  };
  const adapter = {
    platform,
    supported,
    capabilities: Object.freeze({
      nativeDesktop,
      /** Linux catalog reads GIO inside the helper. Windows loads GTK only for the palette. */
      giLoader: platform === "linux",
      processInspection: supported,
      /** Process queries that can be answered without waiting (/proc). */
      syncProcessInspection: platform === "linux" || platform === "darwin",
      fileOperations: supported,
    }),
    homeDirectory: homedir,
    userIdentity: () => {
      backend("userIdentity");
      const { uid, gid } = userInfo();
      if (platform === "win32" && uid < 0) return { uid: 1000, gid: 1000 };
      return { uid, gid };
    },
    dataHome: () => backend("dataHome").dataHome(),
    shell: () => backend("shell").shell(),
    shellLaunch: (spec: ShellLaunch) => backend("shellLaunch").shellLaunch(spec),
    installDesktop: (root: string) => backend("installDesktop").installDesktop(root),
    desktopPaths: () => backend("desktopPaths").desktopPaths(),
    requireSupported: (operation: string) => {
      if (!supported || (operation === "native desktop" && !nativeDesktop))
        throw new UnsupportedPlatformError(platform, operation);
    },
    processes: {
      /** Last known listing without waiting; null before one exists (Windows) or when unsupported. */
      trackConsole: (pid: number) =>
        supported ? backend("processes.trackConsole").trackConsole(pid) : undefined,
      untrackConsole: (pid: number) =>
        supported ? backend("processes.untrackConsole").untrackConsole(pid) : undefined,
      /** The last listing only if it is younger than `maxAgeMs`. */
      recent: (maxAgeMs: number) =>
        supported ? backend("processes.recent").recentProcesses(maxAgeMs) : null,
      snapshot: () => (supported ? backend("processes.snapshot").snapshotProcesses() : null),
      list: async () => (supported ? await backend("processes.list").listProcesses() : null),
      signal: (pid: number, signal: NodeJS.Signals) =>
        backend("processes.signal").signalProcess(pid, signal),
      descendants: async (pid: number) => await backend("processes.descendants").descendants(pid),
      /** Only where `capabilities.syncProcessInspection`: needed while the process is exiting. */
      descendantsSync: (pid: number) => backend("processes.descendantsSync").descendantsSync(pid),
      identity: async (pid: number) => await backend("processes.identity").processIdentity(pid),
      workingDirectories: (pid: number, fallback: string) =>
        backend("processes.workingDirectories").workingDirectories(pid, fallback),
      workingDirectory: (pid: number, fallback: string) =>
        backend("processes.workingDirectory").workingDirectory(pid, fallback),
      async waitForExit(pid: number, timeoutMs = 15000) {
        if ((await adapter.processes.identity(pid)) === null) return;
        // Signal 0 only probes existence. Reading the identity on every tick would start a
        // process listing per tick on Windows; a pid cannot be recycled within the timeout.
        const alive = () => {
          try {
            process.kill(pid, 0);
            return true;
          } catch (error) {
            return (error as NodeJS.ErrnoException).code === "EPERM";
          }
        };
        const deadline = Date.now() + timeoutMs;
        while (alive()) {
          if (Date.now() >= deadline) throw new Error(`Процесс ${pid} не завершился`);
          await sleep(50);
        }
      },
    },
    tools: {
      commandExists: (bin: string, env?: Record<string, string | undefined>) =>
        backend("commandExists").commandExists(bin, env),
      agentEnv: (base: Record<string, string | undefined>) => backend("agentEnv").agentEnv(base),
      spawnAgentProcess: (spec: AgentProcessSpec) =>
        backend("spawnAgentProcess").spawnAgentProcess(spec),
      agentLaunch: (spec: Pick<AgentProcessSpec, "command" | "args">) =>
        backend("agentLaunch").agentLaunch(spec),
      agentHostAddress: (dir: string) => backend("agentHostAddress").agentHostAddress(dir),
      spawnAgentHost: (spec: AgentHostSpec) => backend("spawnAgentHost").spawnAgentHost(spec),
      killAgentTree: (pid: number) => backend("killAgentTree").killAgentTree(pid),
      readClaudeAccessToken: () => backend("readClaudeAccessToken").readClaudeAccessToken(),
      readOpenCodeGoKey: () => backend("readOpenCodeGoKey").readOpenCodeGoKey(),
      readCursorAccessToken: () => backend("readCursorAccessToken").readCursorAccessToken(),
      startCodexAppServer: () => backend("startCodexAppServer").startCodexAppServer(),
      runDockerSync: (args: string[]) => backend("runDockerSync").runDockerSync(args),
      runDocker: (
        args: string[],
        options?: { cwd?: string; timeout?: number; signal?: AbortSignal },
      ) => backend("runDocker").runDocker(args, options),
      runNodeScript: (
        script: string,
        args: string[],
        options?: { cwd?: string; timeout?: number; signal?: AbortSignal },
      ) => backend("runNodeScript").runNodeScript(script, args, options),
      runBash: (command: string, options: { cwd: string; signal?: AbortSignal }) =>
        backend("runBash").runBash(command, options),
      /** 0600 on POSIX; on Windows only the current user stays in the file's ACL. */
      restrictToOwner: (path: string) => backend("restrictToOwner").restrictToOwner(path),
      restrictToOwnerSync: (path: string) =>
        backend("restrictToOwnerSync").restrictToOwnerSync(path),
      isExecutableFile: (name: string, mode: number) =>
        backend("isExecutableFile").isExecutableFile(name, mode),
      ptyCommand: (file: string, args: string[]) => backend("ptyCommand").ptyCommand(file, args),
      gitAskpass: (spec: AskpassSpec) => backend("gitAskpass").gitAskpass(spec),
      /** Moves `source` to a new `destination`; an existing one rejects with code `EEXIST`. */
      publishDirectory: (source: string, destination: string) =>
        backend("publishDirectory").publishDirectory(source, destination),
      removeAgentHostAddress: (dir: string, address: string) =>
        backend("removeAgentHostAddress").removeAgentHostAddress(dir, address),
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
      activateSurface: (surface: object) => backend("activateSurface").activateSurface(surface),
    },
    /** OS secret store (Linux: Secret Service over D-Bus). `available` never throws. */
    secrets: {
      available: () =>
        supported ? backend("secrets.available").secretsAvailable() : Promise.resolve(false),
      get: (key: SecretKey) => backend("secrets.get").getSecret(key),
      set: (key: SecretKey, label: string, value: string) =>
        backend("secrets.set").setSecret(key, label, value),
      delete: (key: SecretKey) => backend("secrets.delete").deleteSecret(key),
    },
    pickFolder: () => backend("pickFolder").pickFolder(),
    catalog: () => backend("catalog").catalog(),
    async runDesktop(url: string, action: DesktopAction, options: ResidentOptions) {
      if (!nativeDesktop) throw new UnsupportedPlatformError(platform, "runDesktop");
      const { runResident } = await backend("runDesktop").resident();
      return runResident(url, action, options);
    },
    desktopPid: (service: string) =>
      supported ? backend("desktopPid").desktopPid(service) : Promise.resolve(undefined),
    shortcutStatus: () =>
      supported
        ? backend("shortcutStatus").shortcutStatus()
        : Promise.resolve({ supported: false, active: false, shortcut: "" }),
    shortcutAvailable: (shortcut: string) =>
      supported
        ? backend("shortcutAvailable").shortcutAvailable(shortcut)
        : Promise.resolve({ supported: false, available: false }),
    toolchainBin: () => join(homedir(), ".vite-plus/bin"),
  };
  return Object.freeze(adapter);
}
export const os = createOs();

export type OsAdapter = ReturnType<typeof createOs>;
