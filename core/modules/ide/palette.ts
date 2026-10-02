import type { CommandContext, CommandInfo } from "./commands.ts";
export interface PaletteCommand extends CommandInfo {
  group: string;
}
export function paletteCommands(
  commands: CommandInfo[],
  scopes: { id: string; context: CommandContext }[],
  sourceScope: string,
  query = "",
): PaletteCommand[] {
  const contexts = new Map(scopes.map((scope) => [scope.id, scope.context]));
  const source = contexts.get(sourceScope);
  const selected = new Map<string, PaletteCommand>();
  for (const command of commands) {
    if (command.palette === false) continue;
    const context = contexts.get(command.scope);
    if (source?.projectId && context?.projectId && context.projectId !== source.projectId) continue;
    const group =
      context?.surface === "fileTree"
        ? "Файлы"
        : context?.surface === "editor"
          ? "Редактор"
          : context?.namespace === "ide.editor.tabs"
            ? "Вкладки файлов"
            : context?.namespace === "ide.terminal.tabs"
              ? "Вкладки терминала"
              : context?.surface === "keybindings"
                ? "Горячие клавиши"
                : "IDE";
    const previous = selected.get(command.id);
    if (
      !previous ||
      command.scope === sourceScope ||
      (previous.scope !== sourceScope && command.enabled && !previous.enabled)
    )
      selected.set(command.id, { ...command, group });
  }
  const tokens = query.trim().replace(/^>\s*/, "").toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return [...selected.values()]
    .filter((command) =>
      tokens.every((token) =>
        `${command.title} ${command.id} ${command.group}`.toLocaleLowerCase().includes(token),
      ),
    )
    .sort(
      (a, b) =>
        Number(b.enabled) - Number(a.enabled) ||
        Number(b.scope === sourceScope) - Number(a.scope === sourceScope) ||
        a.title.localeCompare(b.title, "ru") ||
        a.id.localeCompare(b.id),
    );
}
