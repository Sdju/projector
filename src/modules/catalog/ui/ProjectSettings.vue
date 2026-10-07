<script setup lang="ts">
import UiButton from "../../../common/ui/UiButton.vue";
import {
  SettingsWorkbench,
  type SettingsReadoutState,
  type SettingsSection,
} from "../../settings/index.ts";
import { readoutLines } from "../../../common/utilities/tab-readout.ts";
import type { Project } from "../../project/index.ts";
import { shortcutKey } from "../../../../core/modules/ide/index.ts";
import { projectSettingsSection as selected } from "../model/project-settings-nav.ts";
import { createProjectSettingsForm } from "../model/project-settings-form.ts";
import ProjectGeneralSection from "./settings/ProjectGeneralSection.vue";
import ProjectScenariosSection from "./settings/ProjectScenariosSection.vue";
import ProjectLaunchSection from "./settings/ProjectLaunchSection.vue";
import ProjectRemoveSection from "./settings/ProjectRemoveSection.vue";

const props = defineProps<{ project: Project; afterRemove: () => unknown }>();
const emit = defineEmits<{ dirty: [value: boolean] }>();
const form = createProjectSettingsForm(() => props.project, {
  afterRemove: props.afterRemove,
  onDirty: (value) => emit("dirty", value),
});
const { dirty, busy, error, notice, validation } = form;
defineExpose({ canLeave: form.canLeave, save: form.save });

/** Новый раздел настроек проекта — одна запись здесь: список, поиск и навигация общие с настройками Projector. */
const sections: SettingsSection[] = [
  {
    id: "general",
    title: "Основное",
    group: "Проект",
    description: "Название, папка и иконка проекта.",
    keywords: "имя название иконка icon папка путь",
    component: ProjectGeneralSection,
  },
  {
    id: "scenarios",
    title: "Сценарии",
    group: "Запуск",
    description:
      "Команды запуска проекта: dev, build, test и свои. Можно импортировать из package.json.",
    keywords: "команды запуск scripts package.json npm pnpm dev build test сценарии",
    component: ProjectScenariosSection,
  },
  {
    id: "launch",
    title: "Параметры запуска",
    group: "Запуск",
    description: "Команда по умолчанию, адрес приложения и открытие в окне.",
    keywords: "по умолчанию url адрес порт окно window browser",
    component: ProjectLaunchSection,
  },
  {
    id: "remove",
    title: "Убрать проект",
    group: "Управление",
    description: "Убрать проект из Projector; файлы на диске не удаляются.",
    keywords: "удалить убрать delete remove",
    component: ProjectRemoveSection,
  },
];

function saveKey(event: KeyboardEvent) {
  if ((event.ctrlKey || event.metaKey) && shortcutKey(event) === "s") {
    event.preventDefault();
    event.stopPropagation();
    void form.save();
  }
}

// Что штатный агент видит во вкладке настроек проекта: черновик формы и текущий раздел.
const readout = (state: SettingsReadoutState) => {
  const draft = form.draft.value;
  const commands = draft.commands.map(
    (command) =>
      `${command.id === draft.defaultCommandId ? "• " : "  "}${command.name || "(без имени)"} — ${
        command.cmd || "(без команды)"
      }`,
  );
  return {
    note: `Настройки проекта · ${props.project.name}`,
    text: readoutLines(
      `Проект: ${draft.name || "(без имени)"}`,
      `Путь: ${draft.path}`,
      `Раздел: ${state.sectionTitle || state.section || "—"}`,
      draft.url ? `Адрес: ${draft.url} · режим ${draft.mode}` : `Режим: ${draft.mode}`,
      draft.icon ? `Иконка: ${draft.icon}` : "Иконка: не задана",
      `Команды:\n${commands.join("\n")}`,
      `Изменения: ${form.dirty.value ? "есть несохранённые" : "нет"}`,
      form.error.value ? `Ошибка: ${form.error.value}` : "",
      form.dirty.value && form.validation.value ? `Проверка: ${form.validation.value}` : "",
      state.query ? `Поиск: «${state.query}»` : "",
    ),
  };
};
</script>

<template>
  <form
    class="project-settings"
    aria-label="Настройки проекта"
    @submit.prevent="form.save"
    @keydown.capture="saveKey"
  >
    <SettingsWorkbench
      embedded
      title="Настройки проекта"
      scope="settings:project"
      :sections="sections"
      :selected="selected"
      :read="readout"
      @select="selected = $event"
    >
      <template #footer>
        <div class="save-bar">
          <span class="save-status" role="status">{{
            notice || (dirty ? "Есть несохранённые изменения" : "Нет изменений")
          }}</span>
          <UiButton :disabled="busy || !dirty" @click="form.reset()">Сбросить</UiButton>
          <UiButton variant="solid" type="submit" :disabled="busy || !dirty">{{
            busy ? "сохраняю…" : "Сохранить"
          }}</UiButton>
        </div>
        <p v-if="error" class="error" role="alert">{{ error }}</p>
        <p v-else-if="dirty && validation" class="error" role="status">{{ validation }}</p>
      </template>
    </SettingsWorkbench>
  </form>
</template>

<style scoped>
.project-settings {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  font-size: var(--fs-xs);
}
.save-bar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--sp-3);
}
.save-status {
  margin-right: auto;
  color: var(--muted);
  font-size: var(--fs-2xs);
}
.error {
  margin: var(--sp-2) 0 0;
  color: var(--err);
}
</style>
