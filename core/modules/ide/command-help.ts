/** Shared built-in argument documentation. Extensions can override it on registration. */
export function commandHelp(id: string): {
  description: string;
  arguments: Record<string, string>;
} {
  if (id.includes(".tabs.")) {
    const action = id.split(".").at(-1);
    return {
      description:
        "Действие над вкладками области. Без id используется текущая вкладка. Закрытие несохранённого файла может запросить подтверждение.",
      arguments:
        action === "reorder"
          ? { ids: "string[]: все идентификаторы вкладок без повторений в новом порядке" }
          : action === "rename"
            ? {
                id: "string (необязательно): идентификатор вкладки",
                label: "string (необязательно): новое имя; без label откроется ввод имени",
              }
            : { id: "string (необязательно): идентификатор вкладки" },
    };
  }
  if (id === "ide.workbench.terminal.new")
    return {
      description: "Создаёт терминальную сессию в проекте и показывает её вкладку.",
      arguments: { program: "string (необязательно): shell, codex, claude или opencode; по умолчанию shell" },
    };
  if (id.startsWith("ide.workbench.panel."))
    return {
      description:
        "Действие над блоком вкладки: разделить вправо или вниз, скрыть блок. Без id используется активная вкладка блока с фокусом. Разделить можно блок минимум с двумя вкладками.",
      arguments: { id: "string (необязательно): идентификатор вкладки" },
    };
  if (id.startsWith("ide.fileTree.")) {
    const args: Record<string, string> = {
      path: "string (необязательно): путь относительно корня проекта; без него текущая запись дерева",
    };
    args.kind = "string (необязательно): directory для действий над папкой; иначе file";
    if (/\.(create|duplicate|rename|paste)$/.test(id))
      args.directory = "string (необязательно): каталог назначения относительно корня";
    if (/\.(create|duplicate|rename)$/.test(id))
      args.name = "string (необязательно): имя записи; без него откроется диалог";
    if (id.endsWith(".delete"))
      args.confirm =
        "boolean: true только при явном запросе пользователя на удаление; иначе диалог подтверждения";
    return {
      description:
        "Действие в дереве файлов текущего проекта. Явный path не зависит от выбранной строки. Файловые операции возвращают source/destination; открытие файла или диалога возвращает после передачи действия UI.",
      arguments: /\.(refresh|collapseAll|contextMenu)$/.test(id) ? {} : args,
    };
  }
  if (id.startsWith("ide.git."))
    return {
      description:
        "Действие Git в текущем проекте. stage/unstage: path файла, префикс папки или пустая строка для всей группы. discard восстанавливает рабочий файл из индекса; untracked переносит в корзину.",
      arguments: id.endsWith(".refresh")
        ? {}
        : {
            path: "string: путь относительно проекта",
            staged: "boolean (необязательно): true для индекса, false для рабочей версии",
            ...(id.endsWith(".discard")
              ? {
                  confirm:
                    "boolean: true только при явном запросе пользователя на откат; иначе подтверждение",
                }
              : {}),
          },
    };
  if (id.startsWith("ide.editor.file."))
    return {
      description:
        "Действие над уже открытым файлом. Без id используется активный файл. file.open открывает рабочую версию активного сравнения.",
      arguments: { id: "string (необязательно): идентификатор открытой вкладки" },
    };
  if (id === "ide.keybindings.save")
    return {
      description:
        "Сохранить сочетание, записанное в открытом диалоге редактора клавиш. Требуется запись с клавиатуры.",
      arguments: {},
    };
  if (id.startsWith("ide.keybindings."))
    return {
      description: "Действие над видимой строкой редактора клавиш.",
      arguments: { command: "string: ID команды строки", index: "number: индекс её привязки" },
    };
  return {
    description: "Действие в указанной области Projector; использует её текущий UI-контекст.",
    arguments: {},
  };
}
