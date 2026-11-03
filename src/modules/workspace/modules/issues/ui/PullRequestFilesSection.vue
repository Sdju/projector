<script setup lang="ts">
import UiHint from "../../../../../common/ui/UiHint.vue";
import { computed, ref, watch } from "vue";
import type { PullRequestChanges } from "../../../../../../core/modules/workspace/index.ts";
import { pullRequestFilesToFileChanges } from "../../../../../../core/modules/workspace/index.ts";
import { workspaceRequest } from "../../../../workspace-api/index.ts";
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

const loaded = ref<PullRequestChanges>();
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
const loading = ref(false);
const error = ref("");
const tree = ref<InstanceType<typeof ChangesTree>>();
let generation = 0;

async function load() {
  const current = ++generation;
  loading.value = true;
  error.value = "";
  try {
    const data = await workspaceRequest<PullRequestChanges>(props.projectId, "pull-files", {
      number: String(props.number),
    });
    if (current !== generation) return;
    loaded.value = data;
  } catch (err) {
    if (current === generation)
      error.value = err instanceof Error ? err.message : "Не удалось прочитать изменения";
  } finally {
    if (current === generation) loading.value = false;
  }
}

watch(
  () => [props.projectId, props.number, props.head] as const,
  () => {
    loaded.value = undefined;
    if (props.snapshot) return;
    void load();
  },
  { immediate: true },
);
watch(
  () => props.snapshot,
  (snapshot) => {
    loaded.value = undefined;
    if (!snapshot) void load();
  },
);
defineExpose({ reveal: (path: string) => tree.value?.reveal(path), refresh: load });
</script>

<template>
  <div class="changes-panel">
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
      empty-text="Файлов нет"
      @open="(path, pinned) => onOpen?.(path, pinned, head)"
    />
  </div>
</template>

<style scoped>
.changes-panel {
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
