import { commandArgs, useCommandScope } from "../../../common/utilities/commands.ts";
import {
  inspectCommands,
  missingCommands,
  projectDraft,
  settingsError,
  useProjects,
} from "../../project/index.ts";
import type { LaunchMode, Project, ProjectCommand } from "../../project/index.ts";

const text = (value: unknown, name: string) => {
  if (typeof value !== "string") throw new Error(`${name} должен быть строкой`);
  return value.trim();
};

/** IDE commands for project settings: icon, launch parameters and run commands (tasks). */
export function useProjectCommands(
  project: () => Project | undefined,
  settingsDirty: () => boolean,
) {
  const catalog = useProjects();
  let busy = false;
  const current = () => {
    const item = project();
    if (!item) throw new Error("Проект не открыт");
    return item;
  };
  const commands = useCommandScope("project:settings", () => {
    const item = project();
    return {
      surface: "project",
      projectId: item?.id ?? null,
      name: item?.name ?? null,
      icon: item?.icon ?? null,
      url: item?.url ?? null,
      mode: item?.mode ?? null,
      defaultCommandId: item?.defaultCommandId ?? null,
      dirty: settingsDirty(),
    };
  });

  function find(item: Project, args: Record<string, unknown>) {
    const id = args.id === undefined ? undefined : text(args.id, "id");
    const name = args.name === undefined ? undefined : text(args.name, "name");
    if (!id && !name) throw new Error("Укажите id или name команды");
    const found = item.commands.find((command) => (id ? command.id === id : command.name === name));
    if (!found) throw new Error("Команда запуска не найдена");
    return found;
  }
  async function apply(change: (draft: ReturnType<typeof projectDraft>) => void) {
    const item = current();
    if (settingsDirty())
      throw new Error(
        "В открытых настройках есть несохранённые изменения; сохраните или сбросьте их",
      );
    if (busy) throw new Error("Настройки уже сохраняются");
    const draft = projectDraft(item);
    change(draft);
    const error = settingsError(draft);
    if (error) throw new Error(error);
    busy = true;
    try {
      return summary(await catalog.save(item.id, draft));
    } finally {
      busy = false;
    }
  }
  const summary = (item: Project) => ({
    name: item.name,
    path: item.path,
    icon: item.icon,
    url: item.url,
    mode: item.mode,
    defaultCommandId: item.defaultCommandId,
    commands: item.commands,
  });

  const register = (
    id: string,
    title: string,
    description: string,
    args: Record<string, string>,
    run: (args: Record<string, unknown>) => unknown,
    writes = true,
  ) =>
    commands.scope.registerCommand({
      id,
      title,
      description,
      arguments: args,
      enabled: () => !!project() && (!writes || (!settingsDirty() && !busy)),
      run: (value) => run(commandArgs(value)),
    });

  register(
    "ide.project.settings.get",
    "Показать настройки проекта",
    "Возвращает название, иконку, адрес, режим запуска, команду по умолчанию и список команд запуска (таски) с их id.",
    {},
    () => summary(current()),
    false,
  );
  register(
    "ide.project.settings.update",
    "Изменить настройки проекта",
    "Меняет только переданные поля и сохраняет их на диск. Изменения запуска применяются при следующем запуске.",
    {
      name: "string (необязательно): название проекта",
      icon: "string (необязательно): путь к иконке внутри проекта, например public/icon.svg; пустая строка — автоматический выбор",
      url: "string (необязательно): адрес приложения http(s)://…; пустая строка — без адреса",
      mode: "string (необязательно): server — команда работает в терминале, window — открыть окно приложения после запуска (нужен url)",
      defaultCommandId: "string (необязательно): id команды запуска по умолчанию",
    },
    (args) =>
      apply((draft) => {
        if (args.name !== undefined) draft.name = text(args.name, "name");
        if (args.icon !== undefined) draft.icon = text(args.icon, "icon");
        if (args.url !== undefined) draft.url = text(args.url, "url");
        if (args.mode !== undefined) {
          if (args.mode !== "server" && args.mode !== "window")
            throw new Error("mode должен быть server или window");
          draft.mode = args.mode as LaunchMode;
        }
        if (args.defaultCommandId !== undefined)
          draft.defaultCommandId = text(args.defaultCommandId, "defaultCommandId");
      }),
  );
  register(
    "ide.project.command.add",
    "Добавить команду запуска",
    "Добавляет команду запуска (таск), выполняемую в терминале из папки проекта.",
    {
      name: "string: название команды, например dev",
      cmd: "string: команда запуска, например pnpm dev",
      makeDefault: "boolean (необязательно): сделать командой по умолчанию",
    },
    (args) =>
      apply((draft) => {
        const command: ProjectCommand = {
          id: crypto.randomUUID(),
          name: text(args.name, "name"),
          cmd: text(args.cmd, "cmd"),
        };
        if (draft.commands.some((item) => item.name === command.name))
          throw new Error(`Команда «${command.name}» уже существует`);
        draft.commands.push(command);
        if (args.makeDefault === true) draft.defaultCommandId = command.id;
      }),
  );
  register(
    "ide.project.command.update",
    "Изменить команду запуска",
    "Переименовывает команду или меняет её команду запуска. Команда ищется по id или по текущему названию.",
    {
      id: "string (необязательно): id команды",
      name: "string (необязательно): текущее название, если id не указан",
      newName: "string (необязательно): новое название",
      cmd: "string (необязательно): новая команда запуска",
    },
    (args) =>
      apply((draft) => {
        const target = find({ ...current(), commands: draft.commands }, args);
        if (args.newName !== undefined) target.name = text(args.newName, "newName");
        if (args.cmd !== undefined) target.cmd = text(args.cmd, "cmd");
      }),
  );
  register(
    "ide.project.command.remove",
    "Удалить команду запуска",
    "Удаляет команду запуска. Последнюю команду удалить нельзя; если удалена команда по умолчанию, выбирается первая оставшаяся.",
    {
      id: "string (необязательно): id команды",
      name: "string (необязательно): название, если id не указан",
    },
    (args) =>
      apply((draft) => {
        const target = find({ ...current(), commands: draft.commands }, args);
        if (draft.commands.length <= 1) throw new Error("Нужна хотя бы одна команда");
        draft.commands = draft.commands.filter((command) => command.id !== target.id);
        if (draft.defaultCommandId === target.id) draft.defaultCommandId = draft.commands[0]!.id;
      }),
  );
  register(
    "ide.project.command.setDefault",
    "Сделать команду запуска основной",
    "Назначает команду, которая запускается из палитры и списка проектов.",
    {
      id: "string (необязательно): id команды",
      name: "string (необязательно): название, если id не указан",
    },
    (args) =>
      apply((draft) => {
        draft.defaultCommandId = find({ ...current(), commands: draft.commands }, args).id;
      }),
  );
  register(
    "ide.project.command.import",
    "Импортировать скрипты package.json",
    "Добавляет недостающие скрипты из package.json проекта как команды запуска; существующие не меняются.",
    {},
    async () => {
      const item = current();
      const found = missingCommands(item.commands, (await inspectCommands(item.path)).commands);
      if (!found.length) return { added: [] };
      await apply((draft) => draft.commands.push(...found));
      return { added: found.map(({ name, cmd }) => ({ name, cmd })) };
    },
  );
}
