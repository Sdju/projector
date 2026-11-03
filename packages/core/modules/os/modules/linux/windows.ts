import { execFileSync, spawn } from "node:child_process";
import { mkdirSync } from "node:fs";

const BROWSERS = [
  "google-chrome-stable",
  "google-chrome",
  "chromium",
  "chromium-browser",
  "brave-browser",
  "microsoft-edge-stable",
  "microsoft-edge",
];

function which(bin: string): boolean {
  try {
    execFileSync("which", [bin], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function findBrowser(): string | null {
  for (const bin of BROWSERS) {
    if (which(bin)) return bin;
  }
  return null;
}

function tryExec(bin: string, args: string[]): boolean {
  if (!which(bin)) return false;
  try {
    execFileSync(bin, args, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

export function focusAppWindow(appClass: string): boolean {
  return (
    tryExec("wmctrl", ["-xa", appClass]) ||
    tryExec("xdotool", ["search", "--onlyvisible", "--class", appClass, "windowactivate"])
  );
}

function spawnDetached(bin: string, args: string[]): void {
  const child = spawn(bin, args, { detached: true, stdio: "ignore" });
  child.unref();
}

export function openWindow(url: string): void {
  const browser = findBrowser();
  if (browser) {
    spawnDetached(browser, [`--app=${url}`]);
    return;
  }
  spawnDetached("xdg-open", [url]);
}

export function openBrowser(url: string): void {
  spawnDetached("xdg-open", [url]);
}

export function openOrFocusApp(url: string, appClass: string, profile: string): void {
  if (focusAppWindow(appClass)) return;

  mkdirSync(profile, { recursive: true });

  const browser = findBrowser();
  if (browser) {
    spawnDetached(browser, [
      `--app=${url}`,
      `--user-data-dir=${profile}`,
      `--class=${appClass}`,
      `--name=${appClass}`,
      "--no-first-run",
      "--no-default-browser-check",
    ]);
    return;
  }

  spawnDetached("xdg-open", [url]);
}

function paletteWindow(paletteClass: string): string | null {
  try {
    const ids = execFileSync("xdotool", ["search", "--class", `^${paletteClass}$`], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    })
      .trim()
      .split("\n");
    // Chromium also tags invisible helper windows with the app class.
    // WM_STATE identifies the actual managed window, including when hidden.
    for (const id of ids) {
      const state = execFileSync("xprop", ["-id", id, "WM_STATE"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      });
      if (state.startsWith("WM_STATE(WM_STATE)")) return id;
    }
    return null;
  } catch {
    return null;
  }
}

export function hidePalette(paletteClass: string): void {
  const id = paletteWindow(paletteClass);
  if (id) tryExec("xdotool", ["windowunmap", id]);
}

export function openWebPalette(
  url: string,
  toggle: boolean,
  paletteClass: string,
  profile: string,
): void {
  const id = paletteWindow(paletteClass);
  if (id) {
    const active = tryGetActiveWindow();
    if (toggle && active === id) hidePalette(paletteClass);
    else {
      tryExec("xdotool", ["windowmap", id]);
      tryExec("xdotool", ["windowactivate", "--sync", id]);
    }
    return;
  }
  const browser = findBrowser();
  if (!browser) throw new Error("Не найден Chromium-совместимый браузер; выберите режим браузера");
  mkdirSync(profile, { recursive: true });
  spawnDetached(browser, [
    `--app=${url}?surface=window`,
    `--user-data-dir=${profile}`,
    `--class=${paletteClass}`,
    `--name=${paletteClass}`,
    "--window-size=660,500",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-features=Translate",
  ]);
}

function tryGetActiveWindow(): string | null {
  try {
    return execFileSync("xdotool", ["getactivewindow"], { encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

export function closePalette(paletteClass: string): void {
  const id = paletteWindow(paletteClass);
  if (id) tryExec("xdotool", ["windowclose", id]);
}
export function activateWindow(id: number | bigint): void {
  const child = spawn("xdotool", ["windowactivate", "--sync", String(id)], { stdio: "ignore" });
  child.on("error", () => {});
}

/** X11 needs an explicit raise. Wayland activates the window through the compositor. */
export async function activateSurface(surface: object): Promise<void> {
  try {
    const { default: GdkX11 } = await import("gi:GdkX11-4.0");
    if (surface instanceof GdkX11.X11Surface) activateWindow(surface.getXid());
  } catch {
    /* The surface is not an X11 window. */
  }
}
