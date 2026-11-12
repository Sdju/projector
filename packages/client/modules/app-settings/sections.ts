import { HubSettings } from "../hub/index.ts";
import { FavoriteFolders, InterfaceSettings } from "../launcher/index.ts";
import { EditorSettings, FilesExcludeSettings } from "../workspace/index.ts";
import { KeybindingsEditor } from "../ide/index.ts";
import { NetworkSettings, OpenAiGatewaySettings } from "../network/index.ts";
import { GithubSettings } from "../github/index.ts";
import { GitlabSettings } from "../gitlab/index.ts";
import { DockerSettings } from "../docker/index.ts";
import { ProviderPanel } from "../provider/index.ts";
import { PwaSettings } from "../pwa/index.ts";
import { PluginSettings } from "../plugins/index.ts";
import {
  AgentHooksSettings,
  AgentMcpSettings,
  AgentSkillsSettings,
  AgentSettings,
  AgentWebSettings,
  AgentMemorySettings,
  AgentJudgeSettings,
} from "../agent/index.ts";
import { AgentRoleSettings } from "../agent-roles/index.ts";
import { AgentPresetsSettings } from "../agent-presets/index.ts";
import { type SettingsSection } from "../settings/index.ts";

export const settingsSections: SettingsSection[] = [
  {
    id: "interface",
    title: "Интерфейс",
    group: "Среда",
    description: "Режим запуска, системная горячая клавиша и цветовая схема.",
    keywords:
      "окно браузер GTK трей хоткей shortcut запуск цвет тема схема светлая тёмная appearance",
    component: InterfaceSettings,
  },
  {
    id: "plugins",
    title: "Плагины",
    group: "Среда",
    description: "Локальные пакеты с темами и декларативными ACP-агентами.",
    keywords:
      "плагины расширения темы цвета схемы агент ACP доверие локальная папка plugins agents themes",
    component: PluginSettings,
  },
  {
    id: "pwa",
    title: "Приложение",
    group: "Среда",
    description: "Установка на домашний экран, отдельное окно и полноэкранный режим.",
    keywords:
      "pwa установка приложение иконка домашний экран ярлык fullscreen полный экран standalone service worker кеш офлайн",
    component: PwaSettings,
  },
  {
    id: "folders",
    title: "Избранные папки",
    group: "Среда",
    description:
      "Папки с проектами: их проекты идут первыми, на диске ищутся ещё не открытые, внутри создаются новые.",
    keywords: "избранное папки проекты создать новый проект каталог на диске favorite folder",
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
    id: "hub",
    title: "Hub",
    group: "Подключения",
    description: "Подключение этой машины к общему веб-интерфейсу Projector.",
    keywords: "hub устройства удалённый доступ туннель токен сервер QR телефон вход",
    component: HubSettings,
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
    id: "agents",
    title: "Агенты",
    group: "Агент",
    description:
      "Включение, режим сессий и возможности каждого адаптера — на одной странице у агента.",
    keywords:
      "интеграции адаптеры кодовые агенты включить отключить выключить сессия терминал GUI TUI графический чат режим вывод возможности умения фичи виджеты widgets графики формы команды IDE MCP",
    component: AgentSettings,
  },
  {
    id: "agent-roles",
    title: "Роли агентов",
    group: "Агент",
    description: "Служебные роли и пресеты чатов: агент, модель и настройки.",
    keywords:
      "роли agent roles doctor lens judge доктор линза судья модель служебные внутренние вызовы chat роль чата пресет preset",
    component: AgentRoleSettings,
  },
  {
    id: "agent-presets",
    title: "Пресеты агента",
    group: "Агент",
    description:
      "Готовые первые запросы для любого агента: обычный текст или форма, которую агент написал.",
    keywords:
      "пресеты preset старт стартовые чипы chips запросы prompt форма form подсказки suggestions",
    component: AgentPresetsSettings,
  },
  {
    id: "agent-judge",
    title: "Судья Projector",
    group: "Агент",
    description: "Оценка риска действий и автоматическое разрешение безопасных запросов.",
    keywords: "судья judge риск безопасность подтверждение разрешение авто threshold",
    component: AgentJudgeSettings,
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
