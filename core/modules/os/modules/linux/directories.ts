import { homedir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execute = promisify(execFile);
export function dataHome() {
  return process.env.XDG_DATA_HOME || join(homedir(), ".local/share");
}
export function configHome() {
  return process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
}
export function shell() {
  return process.env.SHELL || "/bin/bash";
}
export function desktopPaths() {
  return {
    applications: join(dataHome(), "applications"),
    icons: join(dataHome(), "icons/hicolor"),
    bin: join(homedir(), ".local/bin"),
  };
}
export async function pickFolder(): Promise<string | null> {
  const dialogs = [
    { bin: "zenity", args: ["--file-selection", "--directory", "--title=Выберите проект"] },
    { bin: "yad", args: ["--file-selection", "--directory", "--title=Выберите проект"] },
    { bin: "kdialog", args: ["--getexistingdirectory", homedir(), "Выберите проект"] },
  ];
  for (const dialog of dialogs) {
    try {
      const { stdout } = await execute(dialog.bin, dialog.args, {
        timeout: 180000,
        env: process.env,
      });
      return stdout.trim() || null;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (String(code) === "1") return null;
      if (code !== "ENOENT") throw error;
    }
  }
  throw new Error("Нет zenity / yad / kdialog для выбора папки");
}
