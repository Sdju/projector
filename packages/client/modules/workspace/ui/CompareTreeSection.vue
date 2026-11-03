<script setup lang="ts">
import UiHint from "../../../common/ui/UiHint.vue";
import { computed, ref, watch } from "vue";
import { ChangesTree } from "../modules/issues/index.ts";
import {
  fileScopeKey,
  type FileChangeList,
  type FileScope,
} from "@projector/core/modules/workspace/index.ts";
import { workspaceScopeRequest } from "../../workspace-api/index.ts";

/** Изменённые файлы двух снимков в боковой панели; строки открывают diff. */
const props = defineProps<{
  projectId: string;
  scope: FileScope;
  revision?: number;
  selected?: string;
  onOpen?: (path: string, pinned?: boolean, originalPath?: string) => void;
}>();
const data = ref<FileChangeList>();
const loading = ref(false);
const error = ref("");
const tree = ref<InstanceType<typeof ChangesTree>>();
let generation = 0;

const files = computed(() => data.value?.changes ?? []);
const summary = computed(() => {
  const changes = files.value;
  return {
    files: changes.length,
    additions: changes.reduce((sum, change) => sum + (change.additions ?? 0), 0),
    deletions: changes.reduce((sum, change) => sum + (change.deletions ?? 0), 0),
    truncated: data.value?.truncated === true,
  };
});

async function load() {
  if (props.scope.kind !== "compare") {
    data.value = undefined;
    error.value = "Раздел ждёт сравнение двух снимков";
    return;
  }
  const current = ++generation;
  loading.value = true;
  error.value = "";
  try {
    const next = await workspaceScopeRequest<FileChangeList>(
      props.projectId,
      props.scope,
      "changes",
    );
    if (current === generation) data.value = next;
  } catch (err) {
    if (current === generation)
      error.value = err instanceof Error ? err.message : "Не удалось сравнить снимки";
  } finally {
    if (current === generation) loading.value = false;
  }
}

watch(() => [props.projectId, fileScopeKey(props.scope), props.revision], load, {
  immediate: true,
});
defineExpose({ reveal: (path: string) => tree.value?.reveal(path), refresh: load });
</script>

<template>
  <div class="compare-tree">
    <UiHint v-if="loading" size="xs" leading="inherit" class="note" role="status"
      >загрузка: изменения…</UiHint
    >
    <UiHint v-else-if="error" size="xs" leading="inherit" class="note error" role="alert">{{
      error
    }}</UiHint>
    <ChangesTree
      v-else
      ref="tree"
      :changes="files"
      :totals="summary"
      :selected="selected"
      empty-text="Изменений нет"
      @open="(path, pinned, originalPath) => onOpen?.(path, pinned, originalPath)"
    />
  </div>
</template>

<style scoped>
.compare-tree {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
}
.note {
  margin: 0;
  padding: var(--sp-2) var(--sp-3);
}
.note.error {
  color: var(--err);
}
</style>
