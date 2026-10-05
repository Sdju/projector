import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ShellLaunch } from "../../contract.ts";
import { runPowerShell } from "./ps.ts";

export function dataHome() {
  return (
    process.env.XDG_DATA_HOME ||
    process.env.LOCALAPPDATA ||
    join(homedir(), "AppData", "Local")
  );
}
export function configHome() {
  return (
    process.env.XDG_CONFIG_HOME ||
    process.env.APPDATA ||
    join(homedir(), "AppData", "Roaming")
  );
}
export function desktopPaths() {
  const roaming = process.env.APPDATA || join(homedir(), "AppData", "Roaming");
  return {
    applications: join(roaming, "Microsoft", "Windows", "Start Menu", "Programs"),
    icons: join(dataHome(), "icons"),
    bin: join(dataHome(), "bin"),
  };
}

function gitBashCandidates(): string[] {
  const roots = [
    process.env.ProgramFiles,
    process.env["ProgramFiles(x86)"],
    process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, "Programs"),
  ].filter((root): root is string => Boolean(root));
  return roots.flatMap((root) => [
    join(root, "Git", "bin", "bash.exe"),
    join(root, "Git", "usr", "bin", "bash.exe"),
  ]);
}

/** Git Bash understands the same `-c` scripts as Linux. WSL's System32 bash does not. */
export function bashExecutable(): string | null {
  const fromEnv = process.env.SHELL;
  if (
    fromEnv &&
    existsSync(fromEnv) &&
    !/powershell|pwsh|cmd(?:\.exe)?$/i.test(fromEnv) &&
    !/\\Windows\\(?:System32|Sysnative)\\bash\.exe$/i.test(fromEnv)
  )
    return fromEnv;
  for (const candidate of gitBashCandidates()) if (existsSync(candidate)) return candidate;
  try {
    const found = bashOnPath();
    const match = found.find(
      (line) => line && !/\\Windows\\(?:System32|Sysnative)\\bash\.exe$/i.test(line),
    );
    return match || null;
  } catch {
    return null;
  }
}

function bashOnPath(): string[] {
  return String(
    execFileSync("where.exe", ["bash"], {
      encoding: "utf8",
      windowsHide: true,
      stdio: ["ignore", "pipe", "ignore"],
    }),
  )
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export function shell() {
  return process.env.SHELL || bashExecutable() || "powershell.exe";
}

function bashStyle(file: string) {
  return !/powershell|pwsh|cmd(?:\.exe)?$/i.test(file);
}

export function shellLaunch(spec: ShellLaunch) {
  const file = shell();
  if (!bashStyle(file)) {
    if (spec.kind === "command")
      return { file, args: ["-NoLogo", "-NoProfile", "-Command", spec.command] };
    if (spec.kind === "program")
      return { file, args: ["-NoLogo", "-NoProfile", "-Command", spec.executable] };
    return { file, args: ["-NoLogo"] };
  }
  if (spec.kind === "command") return { file, args: ["-c", spec.command] };
  if (spec.kind === "program") return { file, args: ["-i", "-c", `exec ${spec.executable}`] };
  return { file, args: ["-i"] };
}

export async function pickFolder(): Promise<string | null> {
  try {
    const { stdout } = await runPowerShell(
      `
Add-Type -AssemblyName System.Windows.Forms
$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = 'Выберите проект'
$dialog.ShowNewFolderButton = $true
if ($dialog.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) { exit 1 }
$dialog.SelectedPath
`,
      { timeout: 180000, sta: true },
    );
    return stdout.trim() || null;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    const status = (error as { status?: number }).status;
    if (String(code) === "1" || status === 1) return null;
    throw error;
  }
}
