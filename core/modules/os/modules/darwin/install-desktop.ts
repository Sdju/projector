import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { desktopPaths } from "./directories.ts";
import { gtkAvailable } from "./gtk.ts";

const quote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`;

function packageVersion(root: string) {
  try {
    const raw = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
      version?: string;
    };
    return raw.version || "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function tryExec(bin: string, args: string[]) {
  try {
    execFileSync(bin, args, { stdio: "ignore" });
  } catch {
    /* optional helpers (Launch Services, iconutil) */
  }
}

/** Build Projector.icns from the checkout PNG set for Spotlight / Raycast / Dock. */
function installIcon(root: string, resources: string) {
  const src = join(root, "resources", "icons");
  const sizes: Array<[string, string]> = [
    ["16.png", "icon_16x16.png"],
    ["32.png", "icon_16x16@2x.png"],
    ["32.png", "icon_32x32.png"],
    ["64.png", "icon_32x32@2x.png"],
    ["128.png", "icon_128x128.png"],
    ["256.png", "icon_128x128@2x.png"],
    ["256.png", "icon_256x256.png"],
    ["512.png", "icon_256x256@2x.png"],
    ["512.png", "icon_512x512.png"],
    ["512.png", "icon_512x512@2x.png"],
  ];
  if (!sizes.every(([file]) => existsSync(join(src, file)))) return false;
  const staging = mkdtempSync(join(tmpdir(), "projector-iconset-"));
  const iconset = join(staging, "Projector.iconset");
  const icns = join(resources, "Projector.icns");
  try {
    mkdirSync(iconset);
    for (const [file, name] of sizes) copyFileSync(join(src, file), join(iconset, name));
    execFileSync("iconutil", ["-c", "icns", iconset, "-o", icns], { stdio: "ignore" });
    return existsSync(icns);
  } catch {
    return false;
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

/**
 * Installs `~/.local/bin/projector` and `~/Applications/Projector.app`.
 * The .app is what Raycast, Spotlight and Launchpad index; the CLI alone is invisible to them.
 */
export function installDesktop(root: string) {
  const launch = join(root, "cli", "app", "launch.mjs");
  const { applications, bin } = desktopPaths();
  mkdirSync(bin, { recursive: true });
  const command = join(bin, "projector");
  writeFileSync(command, `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(launch)} "$@"\n`);
  chmodSync(command, 0o755);
  console.log(`команда: ${command}`);

  const app = join(applications, "Projector.app");
  const contents = join(app, "Contents");
  const macos = join(contents, "MacOS");
  const resources = join(contents, "Resources");
  mkdirSync(macos, { recursive: true });
  mkdirSync(resources, { recursive: true });
  const executable = join(macos, "Projector");
  writeFileSync(executable, `#!/bin/sh\nexec ${quote(command)} "$@"\n`);
  chmodSync(executable, 0o755);
  const version = packageVersion(root);
  const hasIcon = installIcon(root, resources);
  const iconEntries = hasIcon
    ? `  <key>CFBundleIconFile</key>
  <string>Projector</string>
`
    : "";
  writeFileSync(
    join(contents, "Info.plist"),
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key>
  <string>Projector</string>
  <key>CFBundleDisplayName</key>
  <string>Projector</string>
  <key>CFBundleIdentifier</key>
  <string>dev.projector.app</string>
  <key>CFBundleVersion</key>
  <string>${version}</string>
  <key>CFBundleShortVersionString</key>
  <string>${version}</string>
  <key>CFBundleExecutable</key>
  <string>Projector</string>
${iconEntries}  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>LSMinimumSystemVersion</key>
  <string>13.0</string>
  <key>NSHighResolutionCapable</key>
  <true/>
</dict>
</plist>
`,
  );
  tryExec(
    "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister",
    ["-f", app],
  );
  console.log(`приложение: ${app}`);
  console.log("откройте Projector из Spotlight, Raycast или Launchpad");

  if (!gtkAvailable()) {
    console.log("GTK4 не найден, ставлю через Homebrew…");
    try {
      execFileSync("brew", ["install", "gtk4", "gobject-introspection", "pkg-config"], {
        stdio: "inherit",
      });
    } catch {
      console.log("Не удалось: выполните brew install gtk4 gobject-introspection pkg-config");
    }
  }
}
