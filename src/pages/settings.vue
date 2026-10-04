<script setup lang="ts">
import { computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import { InterfaceSettings } from "../modules/launcher/index.ts";
import { EditorSettings } from "../modules/workspace/index.ts";
import { KeybindingsEditor } from "../modules/ide/index.ts";
import { NetworkSettings } from "../modules/network/index.ts";
import { IntegrationSettings } from "../modules/integrations/index.ts";
import { DockerSettings } from "../modules/docker/index.ts";
import { ProviderPanel } from "../modules/provider/index.ts";
import { SettingsWorkbench, type SettingsSection } from "../modules/settings/index.ts";

const route = useRoute();
const router = useRouter();
const section = computed(() =>
  typeof route.query.section === "string" ? route.query.section : "interface",
);
const sections: SettingsSection[] = [
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
function selectSection(id: string) {
  return router.push({ query: { ...route.query, section: id } });
}
</script>

<template>
  <SettingsWorkbench :sections="sections" :selected="section" @select="selectSection" />
</template>
