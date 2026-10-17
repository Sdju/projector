import type { Project, ProjectCommand, ProjectDraft } from "./types.ts";

export function projectDraft(project: Project): ProjectDraft {
  return {
    name: project.name,
    path: project.path,
    icon: project.icon ?? "",
    url: project.url,
    mode: project.mode,
    defaultCommandId: project.defaultCommandId,
    commands: project.commands.map((command) => ({ ...command })),
  };
}

/** Import only missing commands; preserve custom names, IDs, order and launch defaults. */
export function missingCommands(current: ProjectCommand[], discovered: ProjectCommand[]) {
  return discovered.filter(
    (candidate) =>
      !current.some(
        (command) => command.name.trim() === candidate.name || command.cmd.trim() === candidate.cmd,
      ),
  );
}

/** Why one scenario cannot be saved, or "". Mirrors the server's checks in `parseCommands`. */
export function commandError(command: ProjectCommand, draft: ProjectDraft): string {
  if (!command.name.trim() || !command.cmd.trim())
    return "У сценария должны быть название и команда запуска";
  const folder = (command.cwd ?? "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\.(\/|$)/, "")
    .replace(/\/+$/, "");
  if (folder.startsWith("/") || /^[a-zA-Z]:/.test(folder) || folder.split("/").includes(".."))
    return "Папка сценария должна лежать внутри проекта";
  const url = (command.url ?? "").trim();
  if (url) {
    try {
      if (!["http:", "https:"].includes(new URL(url).protocol)) throw new Error();
    } catch {
      return "Адрес сценария должен начинаться с http:// или https://";
    }
  }
  // An empty mode or address means the project's own; the server drops empty values.
  const mode = command.mode || draft.mode;
  if (mode === "window" && !(url || draft.url.trim()))
    return "Для открытия в окне укажите адрес сценария или проекта";
  return "";
}

/** Why the draft cannot be saved, or "". The first problem is reported; the form marks each scenario. */
export function settingsError(draft: ProjectDraft): string {
  if (!draft.name.trim()) return "Укажите название проекта";
  if (!draft.commands.length) return "Добавьте хотя бы одну команду";
  const names = new Set<string>();
  for (const command of draft.commands) {
    const problem = commandError(command, draft);
    if (problem) return problem;
    const name = command.name.trim();
    if (names.has(name)) return `Сценарий «${name}» уже есть: названия должны различаться`;
    names.add(name);
  }
  if (!draft.commands.some((command) => command.id === draft.defaultCommandId))
    return "Выберите команду по умолчанию";
  if (draft.url.trim()) {
    try {
      const url = new URL(draft.url.trim());
      if (!["http:", "https:"].includes(url.protocol)) throw new Error();
    } catch {
      return "Адрес приложения должен начинаться с http:// или https://";
    }
  }
  return "";
}

/** A copy of a scenario next to it: "<name> копия", then "<name> копия 2", … */
export function duplicateCommand(
  commands: ProjectCommand[],
  id: string,
): ProjectCommand | undefined {
  const at = commands.findIndex((command) => command.id === id);
  if (at < 0) return undefined;
  const source = commands[at]!;
  const names = new Set(commands.map((command) => command.name.trim()));
  let name = `${source.name.trim() || "сценарий"} копия`;
  for (let n = 2; names.has(name); n++) name = `${source.name.trim()} копия ${n}`;
  const copy = { ...source, id: crypto.randomUUID(), name };
  commands.splice(at + 1, 0, copy);
  return copy;
}
