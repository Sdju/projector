import { homedir } from "node:os";
import { join, sep } from "node:path";
import type { LaunchItem } from "../../../launcher/index.ts";
import { runPowerShell, runPowerShellSync } from "./ps.ts";

function roots() {
  const roaming = process.env.APPDATA || join(homedir(), "AppData", "Roaming");
  const common = process.env.ProgramData || join(process.env.SystemDrive || "C:", "ProgramData");
  return [
    join(roaming, "Microsoft", "Windows", "Start Menu"),
    join(common, "Microsoft", "Windows", "Start Menu"),
  ];
}

function allowed(id: string) {
  const normalized = id.replace(/\//g, "\\").toLowerCase();
  if (!normalized.endsWith(".lnk")) return false;
  return roots().some((root) => {
    const prefix = root.replace(/\//g, "\\").toLowerCase();
    return normalized.startsWith(prefix.endsWith("\\") ? prefix : prefix + sep);
  });
}

export function listApplications(): LaunchItem[] {
  const script = `
$shell = New-Object -ComObject WScript.Shell
$roots = $env:PROJECTOR_START_ROOTS -split '\\|'
foreach ($root in $roots) {
  if (-not (Test-Path -LiteralPath $root)) { continue }
  Get-ChildItem -LiteralPath $root -Filter *.lnk -Recurse -ErrorAction SilentlyContinue | ForEach-Object {
    $shortcut = $shell.CreateShortcut($_.FullName)
    $name = $_.BaseName -replace '[\\r\\n\\t]', ' '
    $target = [string]$shortcut.TargetPath -replace '[\\r\\n\\t]', ' '
    Write-Output ($_.FullName + [char]9 + $name + [char]9 + $target)
  }
}
`;
  let stdout = "";
  try {
    stdout = runPowerShellSync(script, {
      timeout: 20000,
      env: { PROJECTOR_START_ROOTS: roots().join("|") },
    });
  } catch {
    return [];
  }
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      const [file, name, target] = line.split("\t");
      if (!file || !name || !allowed(file)) return [];
      return [
        {
          id: `app:${file}`,
          name,
          description: "приложение",
          keywords: target || "",
          kind: "application" as const,
          icon: `/api/launcher/icon?id=${encodeURIComponent(file)}`,
        },
      ];
    });
}

export function launchApplication(id: string) {
  if (!allowed(id)) throw new Error("Приложение больше не доступно");
  runPowerShellSync("Start-Process -LiteralPath $env:PROJECTOR_SHORTCUT", {
    env: { PROJECTOR_SHORTCUT: id },
  });
}

export async function applicationIcon(id: string): Promise<string> {
  if (!allowed(id)) return "";
  try {
    const { stdout } = await runPowerShell(
      `
$shell = New-Object -ComObject WScript.Shell
$icon = [string]$shell.CreateShortcut($env:PROJECTOR_SHORTCUT).IconLocation
$icon.Split(',')[0]
`,
      { env: { PROJECTOR_SHORTCUT: id }, timeout: 8000 },
    );
    const file = stdout.trim();
    return /\.(?:ico|png|svg|bmp)$/i.test(file) ? file : "";
  } catch {
    return "";
  }
}
