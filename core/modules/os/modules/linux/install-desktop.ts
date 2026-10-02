import { copyFileSync, mkdirSync, chmodSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { desktopPaths } from "./directories.ts";

export function installDesktop(root: string) {
  const BIN = join(root, "bin/projector");
  const ICON_SRC = join(root, "resources/icons");
  const { applications: APPLICATIONS, icons: ICONS, bin: LOCAL_BIN } = desktopPaths();
  function ensureDir(path: string) {
    mkdirSync(path, { recursive: true });
  }

  function tryExec(bin: string, args: string[]) {
    try {
      execFileSync(bin, args, { stdio: "ignore" });
    } catch {
      /* optional */
    }
  }

  function installIcons() {
    const svg = join(ICON_SRC, "projector.svg");
    ensureDir(join(ICONS, "scalable/apps"));
    copyFileSync(svg, join(ICONS, "scalable/apps/projector.svg"));

    for (const size of [16, 32, 48, 64, 128, 256, 512]) {
      const png = join(ICON_SRC, `${size}.png`);
      const destDir = join(ICONS, `${size}x${size}/apps`);
      ensureDir(destDir);
      copyFileSync(png, join(destDir, "projector.png"));
    }
  }

  function installDesktopEntry() {
    ensureDir(APPLICATIONS);
    const icon = join(ICONS, "512x512/apps/projector.png");
    const body = `[Desktop Entry]
Type=Application
Version=1.0
Name=Projector
Comment=Поиск и запуск приложений и проектов
Exec="${BIN.replace(/([\\"`$])/g, "\\$1").replace(/%/g, "%%")}"
TryExec=${BIN}
Icon=${icon}
Terminal=false
Categories=Utility;Development;
Keywords=applications;search;vite;pnpm;projects;launcher;
StartupNotify=true
StartupWMClass=Projector
SingleMainWindow=true
X-GNOME-SingleWindow=true
DBusActivatable=false
`;
    writeFileSync(join(APPLICATIONS, "projector.desktop"), body);
  }

  function installBin() {
    chmodSync(BIN, 0o755);
    ensureDir(LOCAL_BIN);
    execFileSync("ln", ["-sfn", BIN, join(LOCAL_BIN, "projector")]);
  }

  installIcons();
  installDesktopEntry();
  installBin();
  tryExec("update-desktop-database", [APPLICATIONS]);
  tryExec("gtk-update-icon-cache", ["-f", ICONS]);

  console.log(`пункт меню: ${join(APPLICATIONS, "projector.desktop")}`);
  console.log(`команда: ${join(LOCAL_BIN, "projector")}`);
  console.log("можно закрепить Projector в меню пуска");
}
