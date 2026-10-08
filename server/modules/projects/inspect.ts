import { readdir, readFile, stat } from "node:fs/promises";
import { os } from "../../../core/modules/os/index.ts";
import { basename, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { findFavicon } from "./favicon.ts";
import type { InspectResult, ProjectCommand } from "./types.ts";

const PREFERRED = ["dev", "start", "preview", "serve"];
const SKIP = new Set([
  ...PREFERRED,
  "build",
  "lint",
  "test",
  "format",
  "fmt",
  "check",
  "typecheck",
  "prepare",
  "preinstall",
  "postinstall",
]);

function commandPrefix(pm: string): string {
  if (pm === "pnpm") return "pnpm";
  if (pm === "yarn") return "yarn";
  if (pm === "bun") return "bun run";
  return "npm run";
}

async function detectPm(dir: string): Promise<string> {
  const files = await readdir(dir);
  if (files.includes("pnpm-lock.yaml") || files.includes("pnpm-workspace.yaml")) {
    return "pnpm";
  }
  if (files.includes("bun.lock") || files.includes("bun.lockb")) return "bun";
  if (files.includes("yarn.lock")) return "yarn";
  if (files.includes("package-lock.json")) return "npm";
  return "pnpm";
}

function guessUrl(scripts: Record<string, string>): string {
  const blob = Object.values(scripts).join(" ");
  if (/\bnext\b/.test(blob)) return "http://localhost:3000";
  if (/\bnuxt\b/.test(blob)) return "http://localhost:3000";
  if (/\bastro\b/.test(blob)) return "http://localhost:4321";
  return "http://localhost:5173";
}

function toCommand(name: string, prefix: string): ProjectCommand {
  return { id: randomUUID(), name, cmd: `${prefix} ${name}` };
}

export function expandPath(input: string): string {
  const trimmed = input.trim();
  if (trimmed === "~") return os.homeDirectory();
  if (trimmed.startsWith("~/") || trimmed.startsWith("~\\"))
    return resolve(join(os.homeDirectory(), trimmed.slice(2)));
  return resolve(trimmed);
}

/** Read script definitions without executing them or replacing project settings. */
export async function inspectProjectCommands(dir: string): Promise<ProjectCommand[]> {
  const path = expandPath(dir);
  const info = await stat(path).catch(() => null);
  if (!info?.isDirectory()) throw new Error("Папка не найдена");
  const raw = await readFile(resolve(path, "package.json"), "utf8").catch(() => null);
  if (!raw) return [];
  const pkg = JSON.parse(raw) as { scripts?: Record<string, unknown> };
  const scripts = pkg.scripts ?? {};
  const prefix = commandPrefix(await detectPm(path));
  const names = [
    ...PREFERRED.filter((name) => name in scripts),
    ...Object.keys(scripts).filter((name) => !PREFERRED.includes(name)),
  ];
  return names
    .filter((name) => typeof scripts[name] === "string" && scripts[name].trim())
    .map((name) => toCommand(name, prefix));
}

export async function inspectProject(dir: string, allowDirectory = false): Promise<InspectResult> {
  const path = expandPath(dir);
  const info = await stat(path).catch(() => null);
  if (!info?.isDirectory()) {
    throw new Error("Папка не найдена");
  }

  const raw = await readFile(resolve(path, "package.json"), "utf8").catch(() => null);
  if (!raw) {
    if (allowDirectory) {
      const command = { id: randomUUID(), name: "shell", cmd: "bash" };
      return {
        name: basename(path) || path,
        path,
        url: "",
        icon: "",
        mode: "server",
        defaultCommandId: command.id,
        commands: [command],
      };
    }
    throw new Error("В папке нет package.json");
  }

  const pkg = JSON.parse(raw) as { name?: string; scripts?: Record<string, string> };
  const scripts = pkg.scripts ?? {};
  const pm = await detectPm(path);
  const prefix = commandPrefix(pm);
  const commands: ProjectCommand[] = [];

  for (const key of PREFERRED) {
    if (scripts[key]) commands.push(toCommand(key, prefix));
  }

  for (const key of Object.keys(scripts)) {
    if (SKIP.has(key) || key.startsWith("pre") || key.startsWith("post")) continue;
    commands.push(toCommand(key, prefix));
  }

  if (commands.length === 0) {
    commands.push(toCommand("dev", prefix));
  }

  const icon = (await findFavicon(path)) ?? "";

  return {
    name: pkg.name || basename(path),
    path,
    url: guessUrl(scripts),
    icon,
    mode: "server",
    defaultCommandId: commands[0].id,
    commands,
  };
}
