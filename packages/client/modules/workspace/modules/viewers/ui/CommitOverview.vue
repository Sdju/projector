<script setup lang="ts">
import UiArticle from "../../../../../common/ui/UiArticle.vue";
import UiHint from "../../../../../common/ui/UiHint.vue";
import UiViewerPage from "../../../../../common/ui/UiViewerPage.vue";
import { computed, ref, watch } from "vue";
import type { GitCommitDetail } from "@projector-ai/core/modules/workspace/index.ts";
import { commandArgs, useCommandScope } from "../../../../../common/utilities/commands.ts";
import { readoutLines, useTabReadout } from "../../../../../common/utilities/tab-readout.ts";
import CommitFiles from "./CommitFiles.vue";
import CommitMeta from "./CommitMeta.vue";
import { useCommitDiffs } from "../lib/commit-diffs.ts";
import { workspaceRequest, workspaceCapabilities } from "../../../../workspace-api/index.ts";
import UiButton from "../../../../../common/ui/UiButton.vue";

/** Вкладка «Обзор коммита»: сообщение, метаданные и все файлы коммита с числом строк. */
const props = defineProps<{
  projectId: string;
  hash: string;
  onOpenTree?: (hash: string) => void;
  onOpenCompare?: (from: string, to: string) => void;
}>();
const emit = defineEmits<{
  openCommit: [hash: string];
  openDiff: [hash: string, path: string];
  subject: [text: string];
}>();
const detail = ref<GitCommitDetail>();
const canOpenTree = computed(() => workspaceCapabilities(props.projectId).snapshots);
const canCompare = computed(
  () => workspaceCapabilities(props.projectId).compare && !!detail.value?.parents[0],
);
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
  id: "ide.git.commit.openChanges",
  title: "Изменения коммита",
  description:
    "Показывает изменённые файлы коммита относительно первого родителя в боковой панели; строки открывают diff.",
  enabled: () => canCompare.value,
  run: () => {
    const parent = detail.value?.parents[0];
    if (parent) props.onOpenCompare?.(parent, props.hash);
  },
});
commands.scope.registerCommand({
  id: "ide.git.commit.openTree",
  title: "Файлы коммита",
  description:
    "Показывает дерево файлов на момент коммита в боковой панели рядом с Git; дерево доступно только для чтения.",
  enabled: () => canOpenTree.value,
  run: () => props.onOpenTree?.(props.hash),
});
// Что штатный агент видит во вкладке обзора коммита: сообщение, автор, статистика и файлы.
useTabReadout(() => {
  if (error.value)
    return { note: `Обзор коммита ${props.hash.slice(0, 7)}`, text: `Ошибка Git: ${error.value}` };
  const data = detail.value;
  if (!data) return { note: `Обзор коммита ${props.hash.slice(0, 7)}`, text: "Загрузка коммита…" };
  const files = data.files.map(
    (file) => `${file.status}\t+${file.additions} -${file.deletions}\t${file.path}`,
  );
  return {
    note: `Обзор коммита ${data.hash.slice(0, 7)}`,
    text: readoutLines(
      `Коммит ${data.hash}`,
      data.subject,
      data.body,
      `Автор: ${data.author} <${data.email}>, ${data.date}`,
      data.refs.length ? `Refs: ${data.refs.map((ref) => ref.name).join(", ")}` : "",
      data.parents.length ? `Родители: ${data.parents.join(", ")}` : "",
      `Итого: +${data.additions} -${data.deletions}, файлов: ${data.files.length}`,
      files.length ? `Файлы:\n${files.join("\n")}` : "Файлы: нет",
      expanded.value.size ? `Раскрыты: ${[...expanded.value].join(", ")}` : "",
    ),
  };
});
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
  <UiViewerPage>
    <UiHint size="xs" leading="inherit" :space-after="2" v-if="loading" class="note" role="status"
      >загрузка коммита…</UiHint
    >
    <UiHint
      size="xs"
      leading="inherit"
      :space-after="2"
      v-else-if="error"
      class="note error"
      role="alert"
      >{{ error }}</UiHint
    >
    <UiArticle v-else-if="detail">
      <CommitMeta :detail="detail" @open-commit="emit('openCommit', $event)" />
      <div v-if="canOpenTree || canCompare" class="commit-actions">
        <UiButton
          v-if="canCompare"
          size="sm"
          data-command="ide.git.commit.openChanges"
          @click="commands.run('ide.git.commit.openChanges')"
        >
          Изменения коммита
        </UiButton>
        <UiButton
          v-if="canOpenTree"
          size="sm"
          data-command="ide.git.commit.openTree"
          @click="commands.run('ide.git.commit.openTree')"
        >
          Файлы коммита
        </UiButton>
      </div>
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
    </UiArticle>
  </UiViewerPage>
</template>

<style scoped>
.commit-actions {
  display: flex;
  justify-content: flex-end;
  margin: 0 0 var(--sp-2);
}
</style>
