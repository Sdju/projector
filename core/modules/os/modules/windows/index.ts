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
  activateSurface,
} from "./windows.ts";

export const catalog = () =>
  import(new URL("./catalog.ts", import.meta.url).href) as Promise<typeof import("./catalog.ts")>;

export const resident = () =>
  import(new URL("./resident.ts", import.meta.url).href) as Promise<typeof import("./resident.ts")>;

export async function desktopPid(service: string): Promise<number | undefined> {
  const { desktopPid: readPid } = await (import(
    new URL("./resident.ts", import.meta.url).href
  ) as Promise<typeof import("./resident.ts")>);
  return readPid(service);
}

export async function shortcutStatus() {
  const { shortcutStatus: readStatus } = await (import(
    new URL("./shortcut.ts", import.meta.url).href
  ) as Promise<typeof import("./shortcut.ts")>);
  return readStatus();
}

export async function shortcutAvailable(shortcut: string) {
  const { shortcutAvailable: readAvailable } = await (import(
    new URL("./shortcut.ts", import.meta.url).href
  ) as Promise<typeof import("./shortcut.ts")>);
  return readAvailable(shortcut);
}

export { gitAskpass, publishDirectory, removeAgentHostAddress } from "./git.ts";
export { installDesktop } from "./install-desktop.ts";
export { startCodexAppServer } from "./codex.ts";
export {
  agentEnv,
  agentHostAddress,
  killAgentTree,
  spawnAgentHost,
  spawnAgentProcess,
} from "./agent-process.ts";
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
