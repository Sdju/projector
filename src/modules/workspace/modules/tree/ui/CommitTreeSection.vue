<script setup lang="ts">
import UiScrollArea from "../../../../../common/ui/UiScrollArea.vue";
import { computed, ref, watch } from "vue";
import FileTree from "./FileTree.vue";
import { workspaceRequest } from "../../../../workspace-api/index.ts";
import type {
  GitCommitDetail,
  GitOverview,
} from "../../../../../../core/modules/workspace/index.ts";

/** Файлы коммита в боковой панели: то же дерево, но только для чтения. */
const props = defineProps<{
  projectId: string;
  rev: string;
  revision?: number;
  selected?: string;
  onOpen?: (path: string, pinned?: boolean) => void;
}>();
const detail = ref<GitCommitDetail>();
const tree = ref<InstanceType<typeof FileTree>>();
const error = ref("");
let generation = 0;
async function load() {
  const current = ++generation;
  error.value = "";
  try {
    const data = await workspaceRequest<GitCommitDetail>(props.projectId, "commit", {
      hash: props.rev,
    });
    if (current === generation) detail.value = data;
  } catch (err) {
    if (current === generation) error.value = err instanceof Error ? err.message : "Ошибка Git";
  }
}
watch(() => [props.projectId, props.rev, props.revision], load, { immediate: true });
const gitChanges = computed<GitOverview["changes"]>(
  () =>
    detail.value?.files.map((file) => ({
      path: file.path,
      originalPath: file.originalPath,
      index: file.status,
      worktree: " ",
    })) ?? [],
);
defineExpose({ reveal: (path: string) => tree.value?.reveal(path) });
</script>

<template>
  <div class="commit-tree">
    <p v-if="error" class="note" role="alert">{{ error }}</p>
    <UiScrollArea v-if="rev" class="side-content">
      <FileTree
        ref="tree"
        :project-id="projectId"
        :rev="rev"
        readonly
        :selected="selected ?? ''"
        :revision="revision ?? 0"
        :git-changes="gitChanges"
        @open="(path, pinned) => onOpen?.(path, pinned)"
      />
    </UiScrollArea>
  </div>
</template>

<style scoped>
.commit-tree {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
}
.note {
  margin: 0;
  padding: var(--sp-2) var(--sp-3);
  color: var(--err);
  font-size: var(--fs-xs);
}
</style>
