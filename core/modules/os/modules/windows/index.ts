export {
  processInfo,
  signalProcess,
  processIdentity,
  listProcesses,
  descendants,
  workingDirectory,
} from "./processes.ts";
export {
  moveNoReplace,
  runPython,
  searchFiles,
  runBash,
  runDocker,
  runDockerSync,
  runNodeScript,
  commandExists,
} from "./tools.ts";
export { dataHome, shell, shellLaunch, desktopPaths, pickFolder } from "./directories.ts";
export {
  focusAppWindow,
  openWindow,
  openBrowser,
  openOrFocusApp,
  hidePalette,
  openWebPalette,
  closePalette,
  activateWindow,
} from "./windows.ts";

export const catalog = () =>
  import(new URL("./catalog.ts", import.meta.url).href) as Promise<typeof import("./catalog.ts")>;

export function resident() {
  return Promise.resolve({
    runResident(_url: string, _action: string, _options: unknown): Promise<void> {
      return Promise.reject(new Error("GTK-палитра доступна только на Linux"));
    },
  });
}

export function desktopPid(_service: string): Promise<number | undefined> {
  return Promise.resolve(undefined);
}

export function shortcutStatus() {
  return Promise.resolve({ supported: false, active: false, shortcut: "" });
}

export function shortcutAvailable(_shortcut: string) {
  return Promise.resolve({ supported: false, available: false });
}

export { installDesktop } from "./install-desktop.ts";
export { startCodexAppServer } from "./codex.ts";
export { spawnAgentProcess } from "./agent-process.ts";
export { readOpenCodeGoKey } from "./opencode.ts";
export { readCursorAccessToken } from "./cursor.ts";

const secrets = () =>
  import(new URL("./secrets.ts", import.meta.url).href) as Promise<typeof import("./secrets.ts")>;
export const secretsAvailable = async () => (await secrets()).secretsAvailable();
export const getSecret = async (...args: Parameters<typeof import("./secrets.ts").getSecret>) =>
  (await secrets()).getSecret(...args);
export const setSecret = async (...args: Parameters<typeof import("./secrets.ts").setSecret>) =>
  (await secrets()).setSecret(...args);
export const deleteSecret = async (
  ...args: Parameters<typeof import("./secrets.ts").deleteSecret>
) => (await secrets()).deleteSecret(...args);

export { readClaudeAccessToken } from "./claude.ts";
