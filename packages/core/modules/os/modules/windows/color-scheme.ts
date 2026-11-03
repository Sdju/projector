import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";

const execute = promisify(execFile);
const personalize = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize";

export type WindowsColorScheme = "dark" | "light";

/** `reg query` prints `AppsUseLightTheme    REG_DWORD    0x0`: 0 is the dark app mode. */
export function parseAppsUseLightTheme(output: string): WindowsColorScheme | undefined {
  const match = /AppsUseLightTheme\s+REG_DWORD\s+0x([0-9a-f]+)/i.exec(output);
  if (!match?.[1]) return;
  return Number.parseInt(match[1], 16) === 0 ? "dark" : "light";
}

/** Windows app color mode. GTK's Win32 backend leaves `gtk-interface-color-scheme` unsupported. */
export async function readWindowsColorScheme(): Promise<WindowsColorScheme | undefined> {
  try {
    const reg = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "reg.exe");
    const { stdout } = await execute(reg, ["query", personalize, "/v", "AppsUseLightTheme"], {
      encoding: "utf8",
      windowsHide: true,
    });
    return parseAppsUseLightTheme(stdout);
  } catch {
    return;
  }
}
