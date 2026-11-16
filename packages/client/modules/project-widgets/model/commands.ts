import type { CommandScope } from "../../../common/utilities/commands.ts";
import { loadProjectWidgets } from "../api.ts";

export function registerProjectWidgetCommands(scope: CommandScope, projectId: () => string): void {
  scope.registerCommand({
    id: "ide.project.widgets.list",
    palette: false,
    title: "Виджеты проекта",
    description:
      "Возвращает виджеты из .projector/widgets.json, путь к файлу, признак доверия и ошибку чтения. Недоверенный файл не попадает ни в промпт, ни в ответы.",
    run: async () => {
      const state = await loadProjectWidgets(projectId());
      return {
        ...state,
        widgets: state.widgets.map(
          ({ template: _template, script: _script, styles: _styles, ...widget }) => widget,
        ),
      };
    },
  });
}
