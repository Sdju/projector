import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";

const BROWSERS = ["Google Chrome", "Chromium", "Brave Browser", "Microsoft Edge", "Arc"].map(
  (name) => ({ name, path: `/Applications/${name}.app` }),
);

function findBrowser(): string | null {
  return BROWSERS.find((browser) => existsSync(browser.path))?.name ?? null;
}

function run(bin: string, args: string[]): void {
  const child = spawn(bin, args, { detached: true, stdio: "ignore" });
  child.on("error", () => {});
  child.unref();
}

function openApp(browser: string, args: string[]): void {
  run("open", ["-na", browser, "--args", ...args]);
}

function http(url: string): string {
  if (!/^https?:\/\//i.test(url)) throw new Error("Допустимы только http(s) адреса");
  return url;
}

/** Cannot address a window by class: macOS has no WM_CLASS. */
export function focusAppWindow(_appClass: string): boolean {
  return false;
}
export function openWindow(url: string): void {
  const browser = findBrowser();
  if (browser) openApp(browser, [`--app=${http(url)}`]);
  else run("open", [http(url)]);
}
export function openBrowser(url: string): void {
  run("open", [http(url)]);
}
export function openOrFocusApp(url: string, _appClass: string, profile: string): void {
  const browser = findBrowser();
  if (!browser) return run("open", [http(url)]);
  mkdirSync(profile, { recursive: true });
  openApp(browser, [
    `--app=${http(url)}`,
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--no-default-browser-check",
  ]);
}
export function hidePalette(_appClass: string): void {}
export function closePalette(_appClass: string): void {}
export function openWebPalette(
  url: string,
  _toggle: boolean,
  _appClass: string,
  profile: string,
): void {
  const browser = findBrowser();
  if (!browser) throw new Error("Не найден Chromium-совместимый браузер; выберите режим браузера");
  mkdirSync(profile, { recursive: true });
  openApp(browser, [
    `--app=${http(url)}?surface=window`,
    `--user-data-dir=${profile}`,
    "--window-size=660,500",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-features=Translate",
  ]);
}
export function activateWindow(_id: number | bigint): void {}
export async function activateSurface(_surface: object): Promise<void> {}
