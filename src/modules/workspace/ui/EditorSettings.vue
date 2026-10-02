<script setup lang="ts">
import { computed, defineAsyncComponent, onMounted, ref } from "vue";
import { editorThemes, type EditorTheme } from "../../../../core/modules/editor-themes/index.ts";
import { editorTheme, applyEditorTheme, loadEditorTheme } from "../lib/monaco.ts";
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
    <label for="editor-theme">Цветовая тема Monaco</label>
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
    <button v-if="!ready && error" @click="load">Повторить загрузку</button>
  </section>
</template>

<style scoped>
.editor-settings {
  margin-bottom: 40px;
}
h1 {
  margin: 0 0 20px;
  font-size: 24px;
  font-weight: 500;
}
label {
  display: block;
  margin-bottom: 8px;
}
select {
  max-width: 420px;
}
select option {
  background: var(--bg-2);
  color: var(--text);
}
.hint {
  color: var(--muted);
  font-size: 13px;
  margin: 12px 0;
}
.preview {
  height: 300px;
  border: 1px solid var(--line);
  border-radius: 4px;
  overflow: hidden;
}
.error {
  color: var(--err);
}
button {
  padding: 8px 12px;
  border: 1px solid var(--line);
  border-radius: 4px;
}
</style>
