<script setup lang="ts">
import UiLoadablePanel from "../../../common/ui/UiLoadablePanel.vue";
import { computed, ref } from "vue";
import { ChangesTree } from "../modules/issues/index.ts";
import {
  fileScopeKey,
  type FileChangeList,
  type FileScope,
} from "@projector-ai/core/modules/workspace/index.ts";
import { workspaceScopeRequest } from "../../workspace-api/index.ts";
import { useAsyncData } from "../../../common/utilities/use-async-data.ts";

/** Изменённые файлы двух снимков в боковой панели; строки открывают diff. */
const props = defineProps<{
  projectId: string;
  scope: FileScope;
  revision?: number;
  selected?: string;
  onOpen?: (path: string, pinned?: boolean, originalPath?: string) => void;
}>();
const { data, loading, error, reload } = useAsyncData<FileChangeList>({
  load: () => workspaceScopeRequest<FileChangeList>(props.projectId, props.scope, "changes"),
  keys: () => [props.projectId, fileScopeKey(props.scope), props.revision],
  enabled: () => props.scope.kind === "compare",
  disabledError: "Раздел ждёт сравнение двух снимков",
  errorFallback: "Не удалось сравнить снимки",
});
const tree = ref<InstanceType<typeof ChangesTree>>();

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

defineExpose({ reveal: (path: string) => tree.value?.reveal(path), refresh: reload });
</script>

<template>
  <UiLoadablePanel :loading="loading" :error="error" loading-text="загрузка: изменения…">
    <ChangesTree
      ref="tree"
      :changes="files"
      :totals="summary"
      :selected="selected"
      empty-text="Изменений нет"
      @open="(path, pinned, originalPath) => onOpen?.(path, pinned, originalPath)"
    />
  </UiLoadablePanel>
</template>
