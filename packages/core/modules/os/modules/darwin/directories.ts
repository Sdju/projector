import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { ShellLaunch } from "../../contract.ts";

const execute = promisify(execFile);
export function dataHome() {
  return process.env.XDG_DATA_HOME || join(homedir(), "Library", "Application Support");
}
export function configHome() {
  return process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
}
export function shell() {
  return process.env.SHELL || "/bin/zsh";
}
export function shellLaunch(spec: ShellLaunch) {
  const file = shell();
  if (spec.kind === "command") return { file, args: ["-c", spec.command] };
  if (spec.kind === "program") return { file, args: ["-i", "-c", `exec ${spec.executable}`] };
  return { file, args: ["-i"] };
}
export function desktopPaths() {
  return {
    applications: join(homedir(), "Applications"),
    icons: join(dataHome(), "Projector", "icons"),
    bin: join(homedir(), ".local/bin"),
  };
}
export async function pickFolder(): Promise<string | null> {
  try {
    const { stdout } = await execute(
      "osascript",
      ["-e", 'POSIX path of (choose folder with prompt "Выберите проект")'],
      { timeout: 180000 },
    );
    return stdout.trim().replace(/\/$/, "") || null;
  } catch (error) {
    if (/-128|User canceled/.test(String((error as { stderr?: string }).stderr))) return null;
    throw error;
  }
}
