<script setup lang="ts">
import UiLabel from "../../../../../common/ui/UiLabel.vue";
import UiMessage from "../../../../../common/ui/UiMessage.vue";
import UiControl from "../../../../../common/ui/UiControl.vue";
import { computed, defineAsyncComponent, onMounted, ref, useId } from "vue";
import UiHeading from "../../../../../common/ui/UiHeading.vue";
import UiButton from "../../../../../common/ui/UiButton.vue";
import { editorThemes, type EditorTheme } from "@ai-projector/core/modules/editor-themes/index.ts";
import { editorTheme, applyEditorTheme, loadEditorTheme } from "../lib/editor-theme.ts";
import { useSectionAction } from "../../../../../common/utilities/use-section-action.ts";
defineProps<{ embedded?: boolean }>();
const titleId = useId();
const themeId = useId();
const CodeViewer = defineAsyncComponent(() => import("./CodeViewer.vue"));
const selected = ref<EditorTheme>(editorTheme.value);
const { ready, busy, error, status, load: loadSection, perform } = useSectionAction();
const description = computed(
  () => editorThemes.find((theme) => theme.id === selected.value)?.description,
);
const example = `// Спокойная подсветка для повседневной работы
interface Project {
  name: string;
  active: boolean;
}

export function recentProjects(projects: Project[], limit = 5) {
  return projects
    .filter((project) => project.active)
    .slice(0, limit)
    .map((project) => \`Открыть \${project.name}\`);
}`;
function load() {
  return loadSection(async () => {
    await loadEditorTheme();
    selected.value = editorTheme.value;
  }, "Не удалось загрузить настройки");
}
onMounted(load);
async function save() {
  await perform(
    async () => {
      const response = await fetch("/api/ide/editor", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ theme: selected.value }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Не удалось сохранить тему");
      applyEditorTheme(selected.value);
    },
    {
      errorFallback: "Не удалось сохранить тему",
      success: "Тема сохранена",
      rollback: () => {
        selected.value = editorTheme.value;
      },
    },
  );
}
</script>

<template>
  <section class="editor-settings" :aria-labelledby="titleId">
    <UiHeading :id="titleId" size="sm" :space-after="4" :class="{ 'u-sr-only': embedded }"
      >Редактор кода</UiHeading
    >
    <UiLabel :for="themeId" :space-after="2">Цветовая тема редактора</UiLabel>
    <UiControl
      as="select"
      :id="themeId"
      v-model="selected"
      :disabled="!ready || busy"
      @change="save"
    >
      <option v-for="theme in editorThemes" :key="theme.id" :value="theme.id">
        {{ theme.title }}
      </option>
    </UiControl>
    <p class="hint">{{ description }}</p>
    <div class="preview"><CodeViewer path="theme-preview.ts" :content="example" /></div>
    <p class="hint">
      Тема применяется к коду и сравнению изменений во всех проектах. Выбор сохраняется
      автоматически.
    </p>
    <UiMessage v-if="error || status" role="status" :tone="error ? 'danger' : undefined">{{
      error || status
    }}</UiMessage>
    <UiButton v-if="!ready && error" @click="load">Повторить загрузку</UiButton>
  </section>
</template>

<style scoped>
.editor-settings {
  margin-bottom: var(--ui-section-margin, var(--sp-6));
}
select {
  max-width: 420px;
}
.hint {
  color: var(--muted);
  font-size: var(--ui-hint-font-size, var(--fs-sm));
  margin: var(--sp-3) 0;
}
.preview {
  height: 240px;
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  overflow: hidden;
}
</style>
