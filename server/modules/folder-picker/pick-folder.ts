import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const DIALOGS: { bin: string; args: string[] }[] = [
  {
    bin: "zenity",
    args: ["--file-selection", "--directory", "--title=Выберите проект"],
  },
  {
    bin: "yad",
    args: ["--file-selection", "--directory", "--title=Выберите проект"],
  },
  {
    bin: "kdialog",
    args: ["--getexistingdirectory", homedir(), "Выберите проект"],
  },
];

function isCancel(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = "code" in error ? error.code : null;
  return code === 1 || code === "1";
}

export async function pickFolder(): Promise<string | null> {
  let missing = 0;
  for (const dialog of DIALOGS) {
    try {
      const { stdout } = await execFileAsync(dialog.bin, dialog.args, {
        timeout: 180_000,
        env: process.env,
      });
      const path = stdout.trim();
      return path || null;
    } catch (error) {
      if (isCancel(error)) return null;
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
        missing += 1;
        continue;
      }
      throw error;
    }
  }
  if (missing === DIALOGS.length) {
    throw new Error("Нет zenity / yad / kdialog для выбора папки");
  }
  return null;
}
