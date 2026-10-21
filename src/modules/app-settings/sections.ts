import { FavoriteFolders, InterfaceSettings } from "../launcher/index.ts";
import { EditorSettings, FilesExcludeSettings } from "../workspace/index.ts";
import { KeybindingsEditor } from "../ide/index.ts";
import { NetworkSettings, OpenAiGatewaySettings } from "../network/index.ts";
import { GithubSettings } from "../github/index.ts";
import { GitlabSettings } from "../gitlab/index.ts";
import { DockerSettings } from "../docker/index.ts";
import { ProviderPanel } from "../provider/index.ts";
import {
  AgentHooksSettings,
  AgentMcpSettings,
  AgentSkillsSettings,
  AgentWebSettings,
  AgentMemorySettings,
  AgentModeSettings,
} from "../agent/index.ts";
import { type SettingsSection } from "../settings/index.ts";

export const settingsSections: SettingsSection[] = [
  {
    id: "interface",
    title: "Интерфейс",
    group: "Среда",
    description: "Режим запуска и системная горячая клавиша.",
    keywords: "окно браузер GTK трей хоткей shortcut запуск",
    component: InterfaceSettings,
  },
  {
    id: "folders",
    title: "Избранные папки",
    group: "Среда",
    description: "Папки с проектами: их проекты идут первыми, внутри создаются новые.",
    keywords: "избранное папки проекты создать новый проект каталог favorite folder",
    component: FavoriteFolders,
  },
  {
    id: "editor",
    title: "Редактор",
    group: "Среда",
    description: "Тема кода и сравнения изменений во всех проектах.",
    keywords: "цвет тема подсветка код diff",
    component: EditorSettings,
    props: { embedded: true },
  },
  {
    id: "files",
    title: "Файлы",
    group: "Среда",
    description: "Исключения дерева проекта и поиска через glob-паттерны files.exclude.",
    keywords:
      "exclude files.exclude glob скрыть дерево node_modules dist .git vendor coverage поиск файлы",
    component: FilesExcludeSettings,
    props: { embedded: true },
  },
  {
    id: "keybindings",
    title: "Горячие клавиши",
    group: "Среда",
    description: "Сочетания клавиш для команд Projector.",
    keywords: "keyboard shortcut хоткей команды сочетания",
    component: KeybindingsEditor,
    props: { embedded: true },
  },
  {
    id: "network",
    title: "Сеть",
    group: "Подключения",
    description: "Доступ с других устройств и пароль локальной сети.",
    keywords: "LAN localhost телефон пароль доступ сервер",
    component: NetworkSettings,
  },
  {
    id: "openai-api",
    title: "OpenAI API",
    group: "Подключения",
    description: "OpenAI-совместимый API Projector для других приложений на машине.",
    keywords: "OpenAI API шлюз gateway proxy v1 chat completions провайдер ключ AI LLM",
    component: OpenAiGatewaySettings,
  },
  {
    id: "github",
    title: "GitHub",
    group: "Подключения",
    description: "Авторизация и папка для импорта репозиториев.",
    keywords: "интеграции OAuth Client ID token токен PAT импорт папка репозиторий",
    component: GithubSettings,
  },
  {
    id: "gitlab",
    title: "GitLab",
    group: "Подключения",
    description: "Токен, адрес сервера и папка для импорта проектов GitLab.",
    keywords: "интеграции gitlab self-hosted token токен PAT импорт папка проект клонирование",
    component: GitlabSettings,
  },
  {
    id: "docker",
    title: "Docker",
    group: "Подключения",
    description: "Локальное окружение Docker и состояние подключения.",
    keywords: "интеграции контейнер context daemon compose окружение",
    component: DockerSettings,
  },
  {
    id: "providers",
    title: "Модели и провайдеры",
    group: "Агент",
    description: "Провайдеры OpenAI-compatible API для агента Projector.",
    keywords: "Qwen OpenAI API key ключ URL модель AI LLM",
    component: ProviderPanel,
  },
  {
    id: "agent-sessions",
    title: "Сессии агентов",
    group: "Агент",
    description: "Терминал или графический чат для новых сессий агентов.",
    keywords: "GUI TUI терминал чат Claude Code режим вывод",
    component: AgentModeSettings,
  },
  {
    id: "agent-memory",
    title: "Память агента",
    group: "Агент",
    description: "Заметки, которые штатный агент помнит между разговорами.",
    keywords: "память заметки запомни memory агент Projector инструкции предпочтения",
    component: AgentMemorySettings,
  },
  {
    id: "agent-mcp",
    title: "MCP-серверы агента",
    group: "Агент",
    description: "Внешние серверы с инструментами для штатного агента.",
    keywords: "mcp сервер инструменты model context protocol агент Projector stdio http sse",
    component: AgentMcpSettings,
  },
  {
    id: "agent-hooks",
    title: "Хуки агента",
    group: "Агент",
    description: "Команды до и после инструментов агента и после его ответа.",
    keywords: "хуки hooks уведомление PreToolUse PostToolUse Stop команда агент Projector",
    component: AgentHooksSettings,
  },
  {
    id: "agent-web",
    title: "Веб-поиск агента",
    group: "Агент",
    description: "Поисковый сервис, через который штатный агент ищет в интернете.",
    keywords: "веб поиск интернет search brave searxng агент Projector ключ",
    component: AgentWebSettings,
  },
  {
    id: "agent-skills",
    title: "Навыки и команды агента",
    group: "Агент",
    description: "Навыки и слэш-команды, которые находит штатный агент.",
    keywords: "навыки skills слэш команды slash prompt SKILL.md агент Projector",
    component: AgentSkillsSettings,
  },
];
