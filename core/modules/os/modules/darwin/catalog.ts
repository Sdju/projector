import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, join, resolve, sep } from "node:path";
import { promisify } from "node:util";
import type { LaunchItem } from "../../../launcher/index.ts";

const execute = promisify(execFile);

function roots() {
  return [
    "/Applications",
    "/Applications/Utilities",
    "/System/Applications",
    "/System/Applications/Utilities",
    join(homedir(), "Applications"),
  ];
}

function allowed(id: string) {
  const path = resolve(id);
  return (
    path.endsWith(".app") && roots().some((root) => path.startsWith(root + sep)) && existsSync(path)
  );
}

/** Bundles have no Gio icon. The palette row falls back to the PNG from `applicationIcon`. */
export function desktopApp(_id: string): { getIcon(): null } {
  return { getIcon: () => null };
}

/** Agents and background-only bundles have no window to open: the analogue of NoDisplay. */
async function hidden(app: string): Promise<boolean> {
  for (const key of ["LSUIElement", "LSBackgroundOnly"]) {
    try {
      const { stdout } = await execute(
        "plutil",
        ["-extract", key, "raw", "-o", "-", join(app, "Contents/Info.plist")],
        { timeout: 5000 },
      );
      if (["true", "1"].includes(stdout.trim().toLowerCase())) return true;
    } catch {
      /* The key is absent. */
    }
  }
  return false;
}

export async function listApplications(): Promise<LaunchItem[]> {
  const seen = new Set<string>();
  const items: LaunchItem[] = [];
  for (const root of roots()) {
    let names: string[];
    try {
      names = readdirSync(root);
    } catch {
      continue;
    }
    for (const entry of names) {
      if (!entry.endsWith(".app")) continue;
      const path = join(root, entry);
      const name = basename(entry, ".app");
      if (seen.has(name)) continue;
      seen.add(name);
      items.push({
        id: `app:${path}`,
        name,
        description: "приложение",
        keywords: path,
        kind: "application" as const,
        icon: `/api/launcher/icon?id=${encodeURIComponent(path)}`,
      });
    }
  }
  const visible: LaunchItem[] = [];
  for (let start = 0; start < items.length; start += 24) {
    const batch = items.slice(start, start + 24);
    const flags = await Promise.all(batch.map((item) => hidden(item.id.slice(4))));
    visible.push(...batch.filter((_, index) => !flags[index]));
  }
  return visible.sort((a, b) => a.name.localeCompare(b.name));
}

export async function launchApplication(id: string) {
  if (!allowed(id)) throw new Error("Приложение больше не доступно");
  await execute("open", ["-a", resolve(id)]);
}

/** Converts the bundle's .icns to a cached PNG; empty when the bundle has no usable icon. */
export async function applicationIcon(id: string): Promise<string> {
  if (!allowed(id)) return "";
  const app = resolve(id);
  try {
    const { stdout } = await execute(
      "plutil",
      ["-extract", "CFBundleIconFile", "raw", "-o", "-", join(app, "Contents/Info.plist")],
      { timeout: 5000 },
    );
    let file = stdout.trim();
    if (!file) return "";
    if (!file.endsWith(".icns")) file += ".icns";
    const source = join(app, "Contents/Resources", file);
    if (!existsSync(source)) return "";
    const cache = join(tmpdir(), "projector-app-icons");
    mkdirSync(cache, { recursive: true });
    const target = join(
      cache,
      `${createHash("sha256").update(app).digest("hex").slice(0, 16)}.png`,
    );
    if (!existsSync(target))
      await execute("sips", ["-s", "format", "png", "-Z", "64", source, "--out", target], {
        timeout: 8000,
      });
    return target;
  } catch {
    return "";
  }
}
