<script setup lang="ts">
import UiScrollArea from "../../../../../common/ui/UiScrollArea.vue";
import UiButton from "../../../../../common/ui/UiButton.vue";
import { computed, ref, watch } from "vue";
import FileTree from "./FileTree.vue";
import { workspaceRequest } from "../../../../workspace-api/index.ts";
import {
  commitFilesToFileChanges,
  fileChangeDecorations,
  fileScopeKey,
  type FileScope,
  type GitCommitDetail,
} from "@projector/core/modules/workspace/index.ts";

/** Файлы снимка в боковой панели: то же дерево, но только для чтения. */
const props = defineProps<{
  projectId: string;
  scope: FileScope;
  revision?: number;
  selected?: string;
  onSearch?: (scope: FileScope) => void;
  onOpen?: (path: string, pinned?: boolean) => void;
}>();
const detail = ref<GitCommitDetail>();
const tree = ref<InstanceType<typeof FileTree>>();
const error = ref("");
let generation = 0;
async function load() {
  if (props.scope.kind !== "commit") {
    detail.value = undefined;
    error.value = "Этот источник пока не умеет показывать файлы";
    return;
  }
  const current = ++generation;
  error.value = "";
  try {
    const data = await workspaceRequest<GitCommitDetail>(props.projectId, "commit", {
      hash: props.scope.rev,
    });
    if (current === generation) detail.value = data;
  } catch (err) {
    if (current === generation) error.value = err instanceof Error ? err.message : "Ошибка Git";
  }
}
watch(() => [props.projectId, fileScopeKey(props.scope), props.revision], load, {
  immediate: true,
});
const decorations = computed(() =>
  fileChangeDecorations(commitFilesToFileChanges(detail.value?.files ?? [])),
);
defineExpose({ reveal: (path: string) => tree.value?.reveal(path) });
</script>

<template>
  <div class="scope-tree">
    <div v-if="onSearch" class="tree-actions">
      <UiButton size="sm" @click="onSearch(scope)">Поиск в снимке</UiButton>
    </div>
    <p v-if="error" class="note" role="alert">{{ error }}</p>
    <UiScrollArea v-if="!error" class="side-content">
      <FileTree
        ref="tree"
        :project-id="projectId"
        :scope="scope"
        :selected="selected ?? ''"
        :revision="revision ?? 0"
        :decorations="decorations"
        @open="(path, pinned) => onOpen?.(path, pinned)"
      />
    </UiScrollArea>
  </div>
</template>

<style scoped>
.scope-tree {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
}
.tree-actions {
  display: flex;
  justify-content: flex-end;
  padding: var(--sp-2) var(--sp-3) 0;
}
.note {
  margin: 0;
  padding: var(--sp-2) var(--sp-3);
  color: var(--err);
  font-size: var(--fs-xs);
}
</style>
