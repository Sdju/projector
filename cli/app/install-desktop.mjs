import { copyFileSync, mkdirSync, chmodSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { writeFileSync } from "node:fs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const HOME = homedir();
const BIN = join(ROOT, "bin/projector");
const ICON_SRC = join(ROOT, "resources/icons");
const APPLICATIONS = join(HOME, ".local/share/applications");
const ICONS = join(HOME, ".local/share/icons/hicolor");
const LOCAL_BIN = join(HOME, ".local/bin");

function ensureDir(path) {
  mkdirSync(path, { recursive: true });
}

function tryExec(bin, args) {
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

function installDesktop() {
  ensureDir(APPLICATIONS);
  const icon = join(ICONS, "512x512/apps/projector.png");
  const body = `[Desktop Entry]
Type=Application
Version=1.0
Name=Projector
Comment=Поиск и запуск приложений и проектов
Exec=${BIN}
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
  try {
    execFileSync("ln", ["-sfn", BIN, join(LOCAL_BIN, "projector")]);
  } catch {
    copyFileSync(BIN, join(LOCAL_BIN, "projector"));
    chmodSync(join(LOCAL_BIN, "projector"), 0o755);
  }
}

installIcons();
installDesktop();
installBin();
tryExec("update-desktop-database", [APPLICATIONS]);
tryExec("gtk-update-icon-cache", ["-f", ICONS]);

console.log(`пункт меню: ${join(APPLICATIONS, "projector.desktop")}`);
console.log(`команда: ${join(LOCAL_BIN, "projector")}`);
console.log("можно закрепить Projector в меню пуска");
