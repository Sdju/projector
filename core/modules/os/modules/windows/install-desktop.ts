import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { desktopPaths } from "./directories.ts";
import { runPowerShellSync } from "./ps.ts";

export function installDesktop(root: string) {
  const launch = join(root, "cli", "app", "launch.mjs");
  const png = join(root, "resources", "icons", "256.png");
  const svg = join(root, "resources", "icons", "projector.svg");
  const { applications, icons, bin } = desktopPaths();
  mkdirSync(applications, { recursive: true });
  mkdirSync(icons, { recursive: true });
  mkdirSync(bin, { recursive: true });
  const source = existsSync(png) ? png : existsSync(svg) ? svg : "";
  const installedIcon = source
    ? join(icons, source.endsWith(".svg") ? "projector.svg" : "projector.png")
    : "";
  if (source) copyFileSync(source, installedIcon);
  const command = join(bin, "projector.cmd");
  writeFileSync(command, `@echo off\r\n"${process.execPath}" "${launch}" %*\r\n`);
  const shortcut = join(applications, "Projector.lnk");
  runPowerShellSync(
    `
$shell = New-Object -ComObject WScript.Shell
$link = $shell.CreateShortcut($env:PROJECTOR_SHORTCUT)
$link.TargetPath = $env:PROJECTOR_NODE
$link.Arguments = '"' + $env:PROJECTOR_LAUNCH + '"'
$link.WorkingDirectory = $env:PROJECTOR_ROOT
$link.WindowStyle = 7
$link.Description = 'Поиск и запуск приложений и проектов'
$link.IconLocation = $env:PROJECTOR_ICON
$link.Save()
`,
    {
      env: {
        PROJECTOR_SHORTCUT: shortcut,
        PROJECTOR_NODE: process.execPath,
        PROJECTOR_LAUNCH: launch,
        PROJECTOR_ROOT: root,
        PROJECTOR_ICON: installedIcon,
      },
    },
  );
  console.log(`пункт меню: ${shortcut}`);
  console.log(`команда: ${command}`);
  console.log("можно закрепить Projector в меню Пуск");
}
