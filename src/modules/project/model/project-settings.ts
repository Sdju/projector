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

export function settingsError(draft: ProjectDraft): string {
  if (!draft.name.trim()) return "Укажите название проекта";
  if (!draft.commands.length) return "Добавьте хотя бы одну команду";
  if (draft.commands.some((command) => !command.name.trim() || !command.cmd.trim()))
    return "У каждой команды должны быть название и команда запуска";
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
  if (draft.mode === "window" && !draft.url.trim())
    return "Укажите адрес приложения для автоматического открытия окна";
  return "";
}
