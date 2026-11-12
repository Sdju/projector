import type { LaunchMode, ProjectCommand } from "./contract.ts";

/** Scenarios live in the project itself, so they travel with the code and its history. */
export const PROJECT_SCENARIOS_FILE = ".projector/scenarios.json";

export interface ProjectScenarios {
  commands: ProjectCommand[];
  defaultCommandId: string;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** A folder inside the project, relative and without `..`; absent or "." means the root. */
export function scenarioFolder(value: unknown): string | undefined {
  const text = asString(value)
    .replace(/\\/g, "/")
    .replace(/^\.(\/|$)/, "")
    .replace(/\/+$/, "");
  if (!text) return undefined;
  if (text.startsWith("/") || /^[a-zA-Z]:/.test(text) || text.split("/").includes(".."))
    throw new Error("Папка сценария должна лежать внутри проекта");
  return text;
}

export function scenarioUrl(value: unknown): string | undefined {
  const text = asString(value);
  if (!text) return undefined;
  try {
    if (["http:", "https:"].includes(new URL(text).protocol)) return text;
  } catch {
    // reported below
  }
  throw new Error("Адрес сценария должен начинаться с http:// или https://");
}

export function parseProjectCommands(value: unknown): ProjectCommand[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    const name = asString(row.name);
    const cmd = asString(row.cmd);
    if (!name || !cmd) return [];
    const command: ProjectCommand = {
      id: asString(row.id) || crypto.randomUUID(),
      name,
      cmd,
    };
    const cwd = scenarioFolder(row.cwd);
    const url = scenarioUrl(row.url);
    if (cwd) command.cwd = cwd;
    if (url) command.url = url;
    if (row.mode === "server" || row.mode === "window") command.mode = row.mode as LaunchMode;
    return [command];
  });
}

/** The contents of `.projector/scenarios.json`; a missing default falls back to the first one. */
export function parseProjectScenarios(value: unknown): ProjectScenarios {
  const row: Record<string, unknown> =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  if (!Array.isArray(row.commands)) throw new Error("В файле сценариев проекта нет commands");
  const commands = parseProjectCommands(row.commands);
  const requested = asString(row.defaultCommandId);
  return {
    commands,
    defaultCommandId: commands.some((command) => command.id === requested)
      ? requested
      : (commands[0]?.id ?? ""),
  };
}
