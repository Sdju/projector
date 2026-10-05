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
export const resident = () =>
  import(new URL("./resident.ts", import.meta.url).href) as Promise<typeof import("./resident.ts")>;

export async function desktopPid(service: string): Promise<number | undefined> {
  if (!process.env.DBUS_SESSION_BUS_ADDRESS) return;
  const { sessionBus, call } = await (import(new URL("./bus.ts", import.meta.url).href) as Promise<
    typeof import("./bus.ts")
  >);
  const bus = sessionBus();
  try {
    const reply = await call(
      bus,
      "org.freedesktop.DBus",
      "/org/freedesktop/DBus",
      "org.freedesktop.DBus",
      "GetConnectionUnixProcessID",
      "s",
      [service],
    );
    return reply?.body[0] as number | undefined;
  } catch {
    return;
  } finally {
    bus.disconnect();
  }
}
export async function shortcutStatus() {
  const { shortcutStatus } = await (import(
    new URL("./shortcut.ts", import.meta.url).href
  ) as Promise<typeof import("./shortcut.ts")>);
  const { sessionBus } = await (import(new URL("./bus.ts", import.meta.url).href) as Promise<
    typeof import("./bus.ts")
  >);
  const bus = sessionBus();
  try {
    return await shortcutStatus(bus);
  } finally {
    bus.disconnect();
  }
}
export async function shortcutAvailable(shortcut: string) {
  const { available } = await (import(new URL("./shortcut.ts", import.meta.url).href) as Promise<
    typeof import("./shortcut.ts")
  >);
  const { sessionBus } = await (import(new URL("./bus.ts", import.meta.url).href) as Promise<
    typeof import("./bus.ts")
  >);
  const bus = sessionBus();
  try {
    return await available(bus, shortcut);
  } finally {
    bus.disconnect();
  }
}

export { installDesktop } from "./install-desktop.ts";

export { startCodexAppServer } from "./codex.ts";
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
