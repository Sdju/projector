<script setup lang="ts">
import UiLoadablePanel from "../../../../../common/ui/UiLoadablePanel.vue";
import { computed, ref } from "vue";
import type { PullRequestChanges } from "@ai-projector/core/modules/workspace/index.ts";
import { pullRequestFilesToFileChanges } from "@ai-projector/core/modules/workspace/index.ts";
import { workspaceRequest } from "../../../../workspace-api/index.ts";
import { useAsyncData } from "../../../../../common/utilities/use-async-data.ts";
import ChangesTree from "./ChangesTree.vue";

/** Дерево изменённых файлов merge request в боковой панели; открывает diff во вкладке. */
const props = defineProps<{
  projectId: string;
  number: number;
  /** Head SHA вкладки MR: меняется — дерево перечитывается. */
  head?: string;
  /** Снимок из уже открытой карточки MR: позволяет не повторять запрос к GitLab. */
  snapshot?: PullRequestChanges;
  onOpen?: (path: string, pinned?: boolean, head?: string) => void;
}>();

const {
  data: loaded,
  loading,
  error,
  reload,
} = useAsyncData<PullRequestChanges>({
  load: () =>
    workspaceRequest<PullRequestChanges>(props.projectId, "pull-files", {
      number: String(props.number),
    }),
  keys: () => [props.projectId, props.number, props.head, props.snapshot],
  enabled: () => !props.snapshot,
  errorFallback: "Не удалось прочитать изменения",
});
const changes = computed(() => loaded.value ?? props.snapshot);
const files = computed(() => pullRequestFilesToFileChanges(changes.value?.files ?? []));
const summary = computed(() => {
  const source = changes.value?.files ?? [];
  return {
    files: changes.value?.changedFiles ?? source.length,
    additions: source.reduce((sum, file) => sum + file.additions, 0),
    deletions: source.reduce((sum, file) => sum + file.deletions, 0),
    capped: changes.value?.changedFilesCapped === true,
    truncated: changes.value?.filesTruncated === true,
  };
});
const head = computed(() => changes.value?.diffRefs?.headSha ?? props.head ?? "");
const tree = ref<InstanceType<typeof ChangesTree>>();

defineExpose({ reveal: (path: string) => tree.value?.reveal(path), refresh: reload });
</script>

<template>
  <UiLoadablePanel :loading="loading" :error="error" loading-text="загрузка: изменения…">
    <ChangesTree
      ref="tree"
      :changes="files"
      :totals="summary"
      empty-text="Файлов нет"
      @open="(path, pinned) => onOpen?.(path, pinned, head)"
    />
  </UiLoadablePanel>
</template>
