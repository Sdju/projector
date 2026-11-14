import { clientAgentByBackend } from "../../agents-integration/catalog/index.ts";
import { parseToolInput } from "./tool-input.ts";

export const toolLabels: Record<string, string> = {
  list_commands: "Поиск команд",
  describe_command: "Описание команды",
  execute_command: "Вызов команды",
  use_skill: "Загрузка навыка",
  Skill: "Загрузка навыка",
  skill: "Загрузка навыка",
  bash: "Команда",
  shell: "Команда",
  terminal: "Терминал",
  run: "Команда",
  run_command: "Команда",
  ask_user: "Вопрос пользователю",
  find_projects: "Поиск проектов",
  inspect_path: "Обзор проекта",
  list_directory: "Обзор папки",
  add_project: "Добавление проекта",
  add_projects: "Добавление проектов",
  list_projects: "Список проектов",
  read: "Чтение файла",
  read_file: "Чтение файла",
  read_media_file: "Чтение изображения",
  view_image: "Чтение изображения",
  edit: "Правка файла",
  edit_file: "Правка файла",
  apply_patch: "Правка файла",
  write: "Запись файла",
  write_file: "Запись файла",
  grep: "Поиск в файлах",
  glob: "Поиск файлов",
  web_fetch: "Загрузка страницы",
  web_search: "Поиск в сети",
  task: "Субагент",
  agent: "Субагент",
  subagent: "Субагент",
  TodoWrite: "План задач",
  TodoList: "План задач",
};

/** Labels are written for the agents that name a tool in CamelCase or snake_case alike. */
const lowerLabels = Object.fromEntries(
  Object.entries(toolLabels).map(([name, label]) => [name.toLowerCase(), label]),
);

/** A call that loads a skill: agents name it `Skill`, `use_skill`, `useSkill` or "Invoke skill <name>". */
export const isSkillCall = (name: string) =>
  /^(?:invoke|load|use)[\s_]*skill\b/i.test(name) || /^skill\b/i.test(name);

/**
 * The skill a loading call works on: the name the agent put in the call title, or the
 * `skill`/`name`/`id` argument. Agents name the field differently, so all three are read.
 */
export function skillCallName(name: string, input = ""): string {
  if (!isSkillCall(name)) return "";
  const titled = /^(?:invoke|load|use)[\s_]*skill\s+(.+)$/i.exec(name)?.[1]?.trim();
  if (titled) return titled;
  const data = parseToolInput(input);
  if (!data) return "";
  for (const key of ["skill", "name", "id"] as const) {
    const value = data[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

export const toolLabel = (
  name: string,
  input = "",
  options?: { label?: string; backend?: string; kind?: string },
) => {
  if (options?.label) return options.label;
  if (isSkillCall(name)) {
    const skill = skillCallName(name, input);
    return skill ? `Загрузка навыка: ${skill}` : "Загрузка навыка";
  }
  if (options?.backend) {
    const custom = clientAgentByBackend(options.backend)?.toolLabel?.({
      name,
      input,
      kind: options.kind,
    });
    if (typeof custom === "string" && custom) return custom;
  }
  return /^reading media\b/i.test(name)
    ? "Чтение изображения"
    : toolLabels[name] || lowerLabels[name.toLowerCase()] || name;
};
