<script setup lang="ts">
import { computed, defineAsyncComponent, onMounted, ref } from "vue";
import UiButton from "../../../common/ui/UiButton.vue";
import { editorThemes, type EditorTheme } from "../../../../core/modules/editor-themes/index.ts";
import { editorTheme, applyEditorTheme, loadEditorTheme } from "../lib/editor-theme.ts";
const CodeViewer = defineAsyncComponent(() => import("./CodeViewer.vue"));
const selected = ref<EditorTheme>(editorTheme.value);
const ready = ref(false);
const busy = ref(false);
const error = ref("");
const status = ref("");
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
async function load() {
  error.value = "";
  try {
    await loadEditorTheme();
    selected.value = editorTheme.value;
    ready.value = true;
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Не удалось загрузить настройки";
  }
}
onMounted(load);
async function save() {
  busy.value = true;
  error.value = "";
  status.value = "";
  try {
    const response = await fetch("/api/ide/editor", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ theme: selected.value }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Не удалось сохранить тему");
    applyEditorTheme(selected.value);
    status.value = "Тема сохранена";
  } catch (err) {
    selected.value = editorTheme.value;
    error.value = err instanceof Error ? err.message : "Не удалось сохранить тему";
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <section class="editor-settings" aria-labelledby="editor-settings-title">
    <h1 id="editor-settings-title">Редактор кода</h1>
    <label for="editor-theme">Цветовая тема редактора</label>
    <select id="editor-theme" v-model="selected" :disabled="!ready || busy" @change="save">
      <option v-for="theme in editorThemes" :key="theme.id" :value="theme.id">
        {{ theme.title }}
      </option>
    </select>
    <p class="hint">{{ description }}</p>
    <div class="preview"><CodeViewer path="theme-preview.ts" :content="example" /></div>
    <p class="hint">
      Тема применяется к коду и сравнению изменений во всех проектах. Выбор сохраняется
      автоматически.
    </p>
    <p v-if="error || status" role="status" :class="{ error }">{{ error || status }}</p>
    <UiButton v-if="!ready && error" @click="load">Повторить загрузку</UiButton>
  </section>
</template>

<style scoped>
.editor-settings {
  margin-bottom: var(--sp-6);
}
h1 {
  margin: 0 0 var(--sp-4);
  font-size: var(--fs-lg);
  font-weight: 500;
}
label {
  display: block;
  margin-bottom: var(--sp-2);
}
select {
  max-width: 420px;
}
.hint {
  color: var(--muted);
  font-size: var(--fs-sm);
  margin: var(--sp-3) 0;
}
.preview {
  height: 300px;
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  overflow: hidden;
}
.error {
  color: var(--err);
}
</style>
