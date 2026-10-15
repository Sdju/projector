export const toolLabels: Record<string, string> = {
  list_commands: "Поиск команд",
  describe_command: "Описание команды",
  execute_command: "Вызов команды",
  bash: "Bash",
  ask_user: "Вопрос пользователю",
  find_projects: "Поиск проектов",
  inspect_path: "Обзор проекта",
  list_directory: "Обзор папки",
  add_project: "Добавление проекта",
  add_projects: "Добавление проектов",
  list_projects: "Список проектов",
  // Claude Code built-in tools
  Read: "Чтение файла",
  Edit: "Правка файла",
  MultiEdit: "Правка файла",
  Write: "Запись файла",
  Grep: "Поиск в файлах",
  Glob: "Поиск файлов",
  WebFetch: "Загрузка страницы",
  WebSearch: "Поиск в сети",
  Task: "Субагент",
  TodoWrite: "План задач",
};

export const toolLabel = (name: string) => toolLabels[name] || name;
