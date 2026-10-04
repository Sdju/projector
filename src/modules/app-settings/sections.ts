import { InterfaceSettings } from "../launcher/index.ts";
import { EditorSettings } from "../workspace/index.ts";
import { KeybindingsEditor } from "../ide/index.ts";
import { NetworkSettings } from "../network/index.ts";
import { IntegrationSettings } from "../integrations/index.ts";
import { DockerSettings } from "../docker/index.ts";
import { ProviderPanel } from "../provider/index.ts";
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
    id: "editor",
    title: "Редактор",
    group: "Среда",
    description: "Тема кода и сравнения изменений во всех проектах.",
    keywords: "цвет тема подсветка код diff",
    component: EditorSettings,
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
    id: "github",
    title: "GitHub",
    group: "Подключения",
    description: "Авторизация и папка для импорта репозиториев.",
    keywords: "интеграции OAuth Client ID token токен PAT импорт папка репозиторий",
    component: IntegrationSettings,
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
];
