<script setup lang="ts">
import { computed, onMounted, ref, useId } from "vue";
import UiHeading from "../../../../../common/ui/UiHeading.vue";
import UiButton from "../../../../../common/ui/UiButton.vue";
import UiHint from "../../../../../common/ui/UiHint.vue";
import UiStringList from "../../../../../common/ui/UiStringList.vue";
import {
  bumpFilesExcludeRevision,
  defaultFilesExclude,
  enabledExcludePatterns,
} from "../lib/files-exclude.ts";
import {
  isValidExcludePattern,
  migratePattern,
  type FilesExcludeMap,
} from "../../../../../../core/modules/workspace/index.ts";

defineProps<{ embedded?: boolean }>();
const titleId = useId();

const exclude = ref<FilesExcludeMap>(defaultFilesExclude());
const ready = ref(false);
const busy = ref(false);
const error = ref("");
const status = ref("");
const patterns = computed(() => enabledExcludePatterns(exclude.value));

async function request(method: string, body?: object) {
  const response = await fetch("/api/ide/files-exclude", {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Не удалось сохранить исключения");
  return data as { exclude: FilesExcludeMap };
}

async function load() {
  error.value = "";
  try {
    exclude.value = (await request("GET")).exclude;
    ready.value = true;
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Не удалось загрузить исключения";
  }
}

async function save(next: FilesExcludeMap) {
  busy.value = true;
  error.value = "";
  status.value = "";
  const previous = exclude.value;
  exclude.value = next;
  try {
    exclude.value = (await request("PUT", { exclude: next })).exclude;
    bumpFilesExcludeRevision();
    status.value = "Сохранено";
  } catch (err) {
    exclude.value = previous;
    error.value = err instanceof Error ? err.message : "Не удалось сохранить исключения";
  } finally {
    busy.value = false;
  }
}

function validate(pattern: string) {
  return isValidExcludePattern(pattern)
    ? ""
    : "Укажите glob-паттерн вроде **/node_modules или *.log";
}

function add(pattern: string) {
  void save({ ...exclude.value, [pattern]: true });
}

function remove(pattern: string) {
  const next = { ...exclude.value };
  delete next[pattern];
  void save(next);
}

function reset() {
  void save(defaultFilesExclude());
}

onMounted(load);
</script>

<template>
  <section class="files-exclude" :aria-labelledby="titleId">
    <UiHeading :id="titleId" size="sm" :class="{ 'u-sr-only': embedded }"
      >Исключения файлов</UiHeading
    >
    <UiHint>
      Glob-паттерны как в VS Code <code>files.exclude</code>: скрывают совпадения из дерева, поиска
      и операций с путями. Примеры: <code>**/node_modules</code>, <code>**/.git</code>,
      <code>*.log</code>.
    </UiHint>
    <UiStringList
      class="list"
      :items="patterns"
      :disabled="!ready || busy"
      mono
      placeholder="**/node_modules"
      empty-text="Нет активных паттернов"
      input-label="Новый glob-паттерн"
      :normalize="migratePattern"
      :validate="validate"
      @add="add"
      @remove="remove"
    >
      <template #actions>
        <UiButton type="button" :disabled="!ready || busy" @click="reset">По умолчанию</UiButton>
      </template>
    </UiStringList>
    <p v-if="error || status" role="status" :class="{ error }">{{ error || status }}</p>
    <UiButton v-if="!ready && error" @click="load">Повторить загрузку</UiButton>
  </section>
</template>

<style scoped>
.files-exclude {
  margin-bottom: var(--sp-6);
}
.list {
  margin-top: var(--sp-4);
}
.error {
  color: var(--err);
}
</style>
