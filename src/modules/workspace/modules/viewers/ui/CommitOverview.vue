<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { GitCommitDetail } from "../../../../../../core/modules/workspace/index.ts";
import { commandArgs, useCommandScope } from "../../../../../common/utilities/commands.ts";
import CommitFiles from "./CommitFiles.vue";
import CommitMeta from "./CommitMeta.vue";
import { useCommitDiffs } from "../lib/commit-diffs.ts";
import { workspaceRequest } from "../../../../workspace-api/index.ts";

/** Вкладка «Обзор коммита»: сообщение, метаданные и все файлы коммита с числом строк. */
const props = defineProps<{ projectId: string; hash: string }>();
const emit = defineEmits<{
  openCommit: [hash: string];
  openDiff: [hash: string, path: string];
  subject: [text: string];
}>();
const detail = ref<GitCommitDetail>();
const error = ref("");
const loading = ref(false);
let generation = 0;
const {
  expanded,
  heights,
  diffs,
  toggle: toggleFile,
  reset,
} = useCommitDiffs(
  () => props.projectId,
  () => props.hash,
);
const commands = useCommandScope(`commit:${props.projectId}:${props.hash}`, () => ({
  surface: "commit",
  projectId: props.projectId,
  hash: props.hash,
}));
const textFiles = computed(() => (detail.value?.files ?? []).filter((file) => !file.binary));
commands.scope.registerCommand({
  id: "ide.git.commit.file.toggle",
  title: "Показать или скрыть код файла коммита",
  description: "Раскрывает изменения файла прямо в обзоре коммита.",
  arguments: { path: "Путь файла относительно папки проекта", open: "true/false — задать явно" },
  run: async (value) => {
    const args = commandArgs(value);
    if (typeof args.path !== "string" || !textFiles.value.some((f) => f.path === args.path))
      throw new Error("Укажите путь текстового файла этого коммита");
    if (args.open !== undefined && typeof args.open !== "boolean")
      throw new Error("open должен быть boolean");
    await toggleFile(args.path, args.open as boolean | undefined);
  },
});
commands.scope.registerCommand({
  id: "ide.git.commit.files.toggleAll",
  title: "Раскрыть или свернуть все файлы коммита",
  description: "Раскрывает код всех текстовых файлов коммита или сворачивает их.",
  arguments: { open: "true — раскрыть всё, false — свернуть; по умолчанию переключает" },
  run: async (value) => {
    const args = commandArgs(value);
    const open = typeof args.open === "boolean" ? args.open : expanded.value.size === 0;
    if (!open) return expanded.value.clear();
    await Promise.all(textFiles.value.map((file) => toggleFile(file.path, true)));
  },
});
async function load() {
  const current = ++generation;
  loading.value = true;
  error.value = "";
  detail.value = undefined;
  reset();
  try {
    const data = await workspaceRequest<GitCommitDetail>(props.projectId, "commit", {
      hash: props.hash,
    });
    if (current !== generation) return;
    detail.value = data;
    emit("subject", data.subject);
  } catch (err) {
    if (current === generation) error.value = err instanceof Error ? err.message : "Ошибка Git";
  } finally {
    if (current === generation) loading.value = false;
  }
}
watch(() => [props.projectId, props.hash], load, { immediate: true });
</script>

<template>
  <div class="overview">
    <p v-if="loading" class="note" role="status">загрузка коммита…</p>
    <p v-else-if="error" class="note error" role="alert">{{ error }}</p>
    <article v-else-if="detail">
      <CommitMeta :detail="detail" @open-commit="emit('openCommit', $event)" />
      <CommitFiles
        :detail="detail"
        :expanded="expanded"
        :heights="heights"
        :diffs="diffs"
        @toggle="(path, open) => commands.run('ide.git.commit.file.toggle', { path, open })"
        @toggle-all="commands.run('ide.git.commit.files.toggleAll')"
        @open-diff="(path) => emit('openDiff', detail!.hash, path)"
        @resize="(path, height) => (heights[path] = height)"
      />
    </article>
  </div>
</template>

<style scoped>
.overview {
  height: 100%;
  overflow: auto;
  padding: var(--sp-4);
}
article {
  max-width: 880px;
}
.note {
  margin: 0 0 var(--sp-2);
  color: var(--muted);
  font-size: var(--fs-xs);
}
.error {
  color: var(--err);
}
</style>
