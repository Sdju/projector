<script setup lang="ts">
import { computed, ref, watch } from "vue";
import UiArticle from "../../../../../common/ui/UiArticle.vue";
import UiButton from "../../../../../common/ui/UiButton.vue";
import UiHeading from "../../../../../common/ui/UiHeading.vue";
import UiHint from "../../../../../common/ui/UiHint.vue";
import UiLoader from "../../../../../common/ui/UiLoader.vue";
import UiMessage from "../../../../../common/ui/UiMessage.vue";
import UiViewerPage from "../../../../../common/ui/UiViewerPage.vue";
import { countRu } from "../../../../../common/utilities/plural.ts";
import { sizeLabel } from "../../../../../common/utilities/release-format.ts";
import { readoutLines, useTabReadout } from "../../../../../common/utilities/tab-readout.ts";
import { useCommandRegistrar, useCommandScope } from "../../../../../common/utilities/commands.ts";
import { workspaceRequest } from "../../../../workspace-api/index.ts";

interface EntryInfo {
  path: string;
  name: string;
  directory: boolean;
  size: number;
  files: number;
  directories: number;
  links: number;
  skipped: number;
  modified: string | null;
  truncated: boolean;
}

const props = defineProps<{ projectId: string; path: string; directory?: boolean }>();
const info = ref<EntryInfo>();
const loading = ref(false);
const error = ref("");
let generation = 0;
const where = computed(() => props.path || "корень проекта");
const title = computed(() => {
  const directory = info.value?.directory ?? props.directory;
  return directory === undefined
    ? "Информация"
    : directory
      ? "Информация о папке"
      : "Информация о файле";
});
const modified = computed(() => {
  const value = info.value?.modified;
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("ru-RU", { dateStyle: "medium", timeStyle: "short" });
});

const commands = useCommandScope(`entryInfo:${props.projectId}:${props.path}`, () => ({
  surface: "entryInfo",
  projectId: props.projectId,
  path: props.path,
}));
const register = useCommandRegistrar(commands.scope);
register(
  "ide.workbench.entryInfo.refresh",
  "Обновить информацию о записи",
  "Перечитывает размер, число файлов и папок и дату последнего изменения.",
  () => load(),
  undefined,
  () => !loading.value,
);

async function load() {
  const current = ++generation;
  loading.value = true;
  error.value = "";
  info.value = undefined;
  try {
    const data = await workspaceRequest<EntryInfo>(props.projectId, "info", {
      path: props.path,
    });
    if (current === generation) info.value = data;
  } catch (value) {
    if (current === generation)
      error.value = value instanceof Error ? value.message : "Не удалось получить информацию";
  } finally {
    if (current === generation) loading.value = false;
  }
}

useTabReadout(() => {
  const note = `Информация: ${where.value}`;
  if (error.value) return { note, text: `Ошибка: ${error.value}` };
  const data = info.value;
  if (!data) return { note, text: "Загрузка…" };
  return {
    note,
    text: readoutLines(
      `${data.directory ? "Папка" : "Файл"}: ${where.value}`,
      `Размер: ${sizeLabel(data.size)}`,
      data.directory ? `Файлов: ${data.files}` : "",
      data.directory ? `Папок: ${data.directories}` : "",
      data.links ? `Символических ссылок: ${data.links}` : "",
      data.skipped ? `Не удалось прочитать: ${data.skipped}` : "",
      modified.value ? `Изменено: ${modified.value}` : "",
      data.truncated ? "Учтена только часть содержимого: папка слишком большая" : "",
    ),
  };
});

watch(() => [props.projectId, props.path], load, { immediate: true });
</script>

<template>
  <UiViewerPage>
    <UiArticle>
      <header class="head">
        <div class="head-text">
          <UiHeading as="h2" size="lg" weight="semibold" :space-after="2">{{ title }}</UiHeading>
          <UiHint size="xs" wrap>{{ where }}</UiHint>
        </div>
        <UiButton
          size="sm"
          data-command="ide.workbench.entryInfo.refresh"
          :busy="loading"
          @click="commands.run('ide.workbench.entryInfo.refresh')"
        >
          Обновить
        </UiButton>
      </header>
      <UiLoader v-if="loading" class="state" size="sm">Считаю размер…</UiLoader>
      <template v-else-if="info">
        <dl class="facts">
          <div>
            <dt>{{ info.directory ? "Размер" : "Размер файла" }}</dt>
            <dd>{{ sizeLabel(info.size) }}</dd>
          </div>
          <template v-if="info.directory">
            <div>
              <dt>Файлов</dt>
              <dd>{{ countRu(info.files, "файл", "файла", "файлов") }}</dd>
            </div>
            <div>
              <dt>Папок</dt>
              <dd>{{ countRu(info.directories, "папка", "папки", "папок") }}</dd>
            </div>
            <div v-if="info.links">
              <dt>Символических ссылок</dt>
              <dd>{{ countRu(info.links, "ссылка", "ссылки", "ссылок") }}</dd>
            </div>
            <div v-if="info.skipped">
              <dt>Не удалось прочитать</dt>
              <dd>{{ countRu(info.skipped, "запись", "записи", "записей") }}</dd>
            </div>
          </template>
          <div v-if="modified">
            <dt>Изменено</dt>
            <dd>{{ modified }}</dd>
          </div>
        </dl>
        <UiMessage v-if="info.truncated" class="state" variant="note" tone="muted" flush>
          Папка слишком большая: учтена только часть содержимого.
        </UiMessage>
      </template>
      <UiMessage v-else-if="error" class="state" variant="note" tone="danger" flush wrap>
        {{ error }}
        <UiButton
          size="sm"
          class="retry"
          data-command="ide.workbench.entryInfo.refresh"
          @click="commands.run('ide.workbench.entryInfo.refresh')"
        >
          Повторить
        </UiButton>
      </UiMessage>
    </UiArticle>
  </UiViewerPage>
</template>

<style scoped>
.head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--sp-4);
  margin-bottom: var(--sp-3);
}
.head-text {
  min-width: 0;
}
.facts {
  display: grid;
  gap: 1px;
  margin: 0;
  padding: 0;
  background: var(--line);
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  overflow: hidden;
}
.facts > div {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--sp-4);
  padding: var(--sp-2) var(--sp-3);
  background: var(--bg-2);
}
.facts dt {
  color: var(--muted);
  font-size: var(--fs-xs);
}
.facts dd {
  margin: 0;
  font-size: var(--fs-xs);
  font-variant-numeric: tabular-nums;
  text-align: right;
}
.state {
  margin-top: var(--sp-3);
}
.retry {
  margin-left: var(--sp-2);
}
@media (max-width: 700px) {
  .head {
    flex-direction: column;
  }
}
</style>
