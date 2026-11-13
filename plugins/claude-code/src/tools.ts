/** The first string path a tool named, in the order Claude Code's own fields use. */
function stringPath(input: unknown, keys: readonly string[]): string[] | undefined {
  if (!input || typeof input !== "object") return undefined;
  const data = input as Record<string, unknown>;
  for (const key of keys) {
    const value = data[key];
    if (typeof value === "string" && value) return [value];
  }
  return undefined;
}

function meta(
  kind: string | undefined,
  label: string | undefined,
  paths?: string[],
): { kind?: string; label?: string; paths?: string[] } {
  return {
    ...(kind ? { kind } : {}),
    ...(label ? { label } : {}),
    ...(paths?.length ? { paths } : {}),
  };
}

/**
 * Kind, label and touched paths of a Claude Code tool call. The chat prefers these over the
 * generic name table; `Skill` leaves `label` unset so the client can format the skill name.
 */
export function claudeToolMeta(
  name: string,
  input: unknown,
): { kind?: string; label?: string; paths?: string[] } {
  switch (name) {
    case "Read":
      return meta("read", "Чтение файла");
    case "ReadMediaFile":
      return meta("read", "Чтение изображения");
    case "Edit":
    case "MultiEdit":
      return meta("edit", "Правка файла", stringPath(input, ["file_path", "filePath", "path"]));
    case "Write":
      return meta("write", "Запись файла", stringPath(input, ["file_path", "filePath", "path"]));
    case "NotebookEdit":
      return meta(
        "edit",
        "Правка блокнота",
        stringPath(input, ["notebook_path", "file_path", "path"]),
      );
    case "Bash":
      return meta("execute", "Команда");
    case "Grep":
      return meta("search", "Поиск в файлах");
    case "Glob":
      return meta("search", "Поиск файлов");
    case "WebFetch":
      return meta("fetch", "Загрузка страницы");
    case "WebSearch":
      return meta("fetch", "Поиск в сети");
    case "Task":
    case "Agent":
      return meta("task", "Субагент");
    case "TodoWrite":
      return meta(undefined, "План задач");
    case "Skill":
      return {};
    default:
      return {};
  }
}
