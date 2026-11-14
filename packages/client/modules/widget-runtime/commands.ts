import {
  commandArgs,
  optionalStringArg,
  type CommandScope,
} from "../../common/utilities/commands.ts";
import { widgetCatalog } from "./registry.ts";

export function registerWidgetCommands(scope: CommandScope): void {
  scope.registerCommand({
    id: "ide.chat.widgets.list",
    palette: false,
    title: "Список встроенных виджетов",
    description:
      "Возвращает актуальные определения встроенных виджетов: имена, назначение, свойства, ограничения и примеры. Для виджетов проекта используй ide.project.widgets.list.",
    run: () => ({ widgets: widgetCatalog.list() }),
  });
  scope.registerCommand({
    id: "ide.chat.widgets.describe",
    palette: false,
    title: "Описание встроенного виджета",
    description:
      "Возвращает полное описание встроенного виджета по имени: свойства, ограничения и пример. Перед первым использованием специального виджета это описание обязательно.",
    arguments: { name: "Имя встроенного виджета, например GitInfo" },
    run: (value) => {
      const name = optionalStringArg(commandArgs(value), "name")?.trim();
      if (!name) throw new Error("Укажите name виджета");
      return { description: widgetCatalog.describe(name) };
    },
  });
}
