import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { desktopPaths } from "./directories.ts";
import { runPowerShellSync } from "./ps.ts";

/** Quote a path for VBScript string literals: wrap in " and double inner quotes. */
function vbsQuote(value: string) {
  return `"${value.replace(/"/g, '""')}"`;
}

/**
 * Command string for WScript.Shell.Run: each argv is quoted, then the whole
 * command is wrapped once more so the Run call sees one VB string.
 * Result: sh.Run """C:\node.exe"" ""C:\launch.ts""", 0, False
 */
function vbsRunCommand(argv: string[]) {
  const inner = argv.map((part) => `"${part.replace(/"/g, '""')}"`).join(" ");
  return vbsQuote(inner);
}

/** Single-size ICO that embeds a PNG (supported since Vista; Start Menu accepts it). */
function writeIcoFromPng(pngPath: string, icoPath: string) {
  const png = readFileSync(pngPath);
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);
  const entry = Buffer.alloc(16);
  entry[0] = 0; // width 256
  entry[1] = 0; // height 256
  entry.writeUInt16LE(1, 4);
  entry.writeUInt16LE(32, 6);
  entry.writeUInt32LE(png.length, 8);
  entry.writeUInt32LE(22, 12);
  writeFileSync(icoPath, Buffer.concat([header, entry, png]));
}

/**
 * Persist `%LOCALAPPDATA%\bin` (or user-level `XDG_DATA_HOME\bin`) on the User PATH.
 * Skips when the install target is not that canonical directory — tests redirect
 * LOCALAPPDATA into Temp, and GetFolderPath still reports the real profile folder.
 */
function ensureUserPath(bin: string) {
  return runPowerShellSync(
    `
$bin = $env:PROJECTOR_BIN
$localBin = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'bin'
$userXdg = [Environment]::GetEnvironmentVariable('XDG_DATA_HOME', 'User')
$xdgBin = if ($userXdg) { Join-Path $userXdg 'bin' } else { $null }
if ($bin -ne $localBin -and $bin -ne $xdgBin) {
  Write-Output 'path-skipped'
  exit 0
}
$user = [Environment]::GetEnvironmentVariable('Path', 'User')
if ($null -eq $user) { $user = '' }
$parts = @($user -split ';' | Where-Object { $_ -ne '' })
foreach ($part in $parts) {
  if ([string]::Equals($part, $bin, [StringComparison]::OrdinalIgnoreCase)) {
    Write-Output 'path-ok'
    exit 0
  }
}
[Environment]::SetEnvironmentVariable('Path', (($parts + $bin) -join ';'), 'User')
Write-Output 'path-added'
`,
    { env: { PROJECTOR_BIN: bin } },
  ).trim();
}

function launchEntry(root: string): string {
  const directory = join(root, "packages", "cli", "app");
  for (const name of ["launch.ts", "launch.js"]) {
    const file = join(directory, name);
    if (existsSync(file)) return file;
  }
  return join(directory, "launch.js");
}

export function installDesktop(root: string) {
  const launch = launchEntry(root);
  const png = join(root, "resources", "icons", "256.png");
  const svg = join(root, "resources", "icons", "projector.svg");
  const { applications, icons, bin } = desktopPaths();
  mkdirSync(applications, { recursive: true });
  mkdirSync(icons, { recursive: true });
  mkdirSync(bin, { recursive: true });

  let installedIcon = "";
  if (existsSync(png)) {
    const installedPng = join(icons, "projector.png");
    copyFileSync(png, installedPng);
    const installedIco = join(icons, "projector.ico");
    writeIcoFromPng(installedPng, installedIco);
    installedIcon = installedIco;
  } else if (existsSync(svg)) {
    installedIcon = join(icons, "projector.svg");
    copyFileSync(svg, installedIcon);
  }

  const command = join(bin, "projector.cmd");
  writeFileSync(command, `@echo off\r\n"${process.execPath}" "${launch}" %*\r\n`);

  // Start Menu must not flash a console: node.exe is a console-subsystem binary.
  // wscript + Run(..., 0) hides the window the way Linux .desktop uses Terminal=false.
  const silent = join(bin, "projector.vbs");
  writeFileSync(
    silent,
    [
      "' Projector — silent Start Menu launch (no console window)",
      'Set sh = CreateObject("WScript.Shell")',
      `sh.CurrentDirectory = ${vbsQuote(root)}`,
      // So launch.ts can show a MessageBox if the hidden process fails.
      'sh.Environment("Process")("PROJECTOR_FROM_SHORTCUT") = "1"',
      `sh.Run ${vbsRunCommand([process.execPath, launch])}, 0, False`,
      "",
    ].join("\r\n"),
  );

  const wscript = join(process.env.SystemRoot || "C:\\Windows", "System32", "wscript.exe");
  const shortcut = join(applications, "Projector.lnk");
  runPowerShellSync(
    `
$shell = New-Object -ComObject WScript.Shell
$link = $shell.CreateShortcut($env:PROJECTOR_SHORTCUT)
$link.TargetPath = $env:PROJECTOR_WSCRIPT
$link.Arguments = '"' + $env:PROJECTOR_SILENT + '"'
$link.WorkingDirectory = $env:PROJECTOR_ROOT
$link.WindowStyle = 1
$link.Description = 'Поиск и запуск приложений и проектов'
if ($env:PROJECTOR_ICON) { $link.IconLocation = $env:PROJECTOR_ICON }
$link.Save()
`,
    {
      env: {
        PROJECTOR_SHORTCUT: shortcut,
        PROJECTOR_WSCRIPT: wscript,
        PROJECTOR_SILENT: silent,
        PROJECTOR_ROOT: root,
        PROJECTOR_ICON: installedIcon,
      },
    },
  );

  console.log(`пункт меню: ${shortcut}`);
  console.log(`команда: ${command}`);
  try {
    const pathStatus = ensureUserPath(bin);
    if (pathStatus === "path-added")
      console.log(`PATH: добавлен ${bin} (откройте новый терминал, чтобы вызвать projector)`);
    else if (pathStatus === "path-ok") console.log(`PATH: ${bin} уже есть`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`PATH: не обновлён (${message}); добавьте ${bin} вручную`);
  }
  console.log("можно закрепить Projector в меню Пуск");
}
