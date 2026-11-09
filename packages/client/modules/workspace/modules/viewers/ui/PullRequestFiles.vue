<script setup lang="ts">
import UiButton from "../../../../../common/ui/UiButton.vue";
import UiHeading from "../../../../../common/ui/UiHeading.vue";
import UiHint from "../../../../../common/ui/UiHint.vue";
import { computed } from "vue";
import type {
  PullRequestComparison,
  PullRequestDiffRefs,
  PullRequestFile,
} from "@projector/core/modules/workspace/index.ts";
import { useFileIconTheme } from "../../../../file-icons/index.ts";
import ChangedFileRow from "./ChangedFileRow.vue";
import type { ChangedFileItem } from "../lib/changed-files.ts";
import IconTree from "~icons/lucide/list-tree";

/** Изменённые файлы merge request: список, раскрываемый diff и вход в дерево панели. */
const props = defineProps<{
  files: PullRequestFile[];
  changedFiles: number;
  changedFilesCapped?: boolean;
  filesTruncated: boolean;
  diffRefs?: PullRequestDiffRefs;
  expanded: Set<string>;
  heights: Record<string, number>;
  diffs: Record<string, { loading: boolean; error: string; data?: PullRequestComparison }>;
  /** Host in the notes: GitLab or GitHub. */
  host?: string;
}>();
const emit = defineEmits<{
  toggle: [path: string, open?: boolean];
  toggleAll: [];
  open: [path: string, pinned?: boolean];
  openTree: [];
  resize: [path: string, height: number];
}>();
const { resolver } = useFileIconTheme();
const host = computed(() => props.host ?? "GitLab");
const MARK: Record<PullRequestFile["status"], string> = {
  added: "A",
  removed: "D",
  modified: "M",
  renamed: "R",
  copied: "C",
  changed: "M",
  unchanged: "·",
};
const files = computed<ChangedFileItem[]>(() =>
  props.files.map((file) => {
    const name = file.path.split("/").at(-1)!;
    return {
      path: file.path,
      name,
      directory: file.path.split("/").slice(0, -1).join("/"),
      icon: resolver.value.resolve({ name, path: file.path, directory: false }, false),
      previousPath: file.previousPath,
      mark: MARK[file.status],
      additions: file.additions,
      deletions: file.deletions,
      binary: !!file.binary,
      tooLarge: file.tooLarge,
      generated: file.generated,
      expandable: !!props.diffRefs && !file.binary && !file.tooLarge,
      openable: !!props.diffRefs && !file.binary && !file.tooLarge,
      disabledTitle: !props.diffRefs
        ? "Diff недоступен"
        : file.binary
          ? "Бинарный файл"
          : file.tooLarge
            ? "Файл слишком большой для diff"
            : "Показать изменения",
      share:
        file.additions + file.deletions ? file.additions / (file.additions + file.deletions) : 0,
    };
  }),
);
const textFiles = computed(() => files.value.filter((file) => file.expandable));
const additions = computed(() => props.files.reduce((sum, file) => sum + file.additions, 0));
const deletions = computed(() => props.files.reduce((sum, file) => sum + file.deletions, 0));
const showTrees = computed(() => !!props.diffRefs);
const totalFiles = computed(() =>
  props.changedFilesCapped ? `${props.changedFiles}+` : String(props.changedFiles),
);
</script>

<template>
  <section class="changes">
    <div class="head">
      <UiHeading as="h3" size="sm" tone="secondary" :space-after="0">
        Изменённые файлы <span class="count">{{ files.length }}</span>
      </UiHeading>
      <span class="totals">
        <b class="add">+{{ additions }}</b>
        <b class="del">−{{ deletions }}</b>
      </span>
      <button
        v-if="showTrees"
        type="button"
        class="tree-button"
        data-command="ide.mergeRequest.files.open"
        title="Открыть дерево изменений в боковой панели"
        @click="emit('openTree')"
      >
        <IconTree aria-hidden="true" />
        Дерево
      </button>
      <UiButton
        v-if="textFiles.length && diffRefs"
        size="sm"
        data-command="ide.mergeRequest.files.toggleAll"
        @click="emit('toggleAll')"
      >
        {{ expanded.size ? "Свернуть всё" : "Развернуть всё" }}
      </UiButton>
    </div>
    <UiHint v-if="!files.length" size="xs" leading="inherit" :space-before="2" class="note"
      >Файлов нет</UiHint
    >
    <ul v-else class="file-list">
      <ChangedFileRow
        v-for="file in files"
        :key="file.path"
        :file="file"
        :expanded="expanded.has(file.path)"
        :diff="diffs[file.path]"
        :height="heights[file.path]"
        open-command="ide.mergeRequest.file.open"
        :host="host"
        @toggle="(open) => emit('toggle', file.path, open)"
        @open="emit('open', file.path)"
        @resize="emit('resize', file.path, $event)"
      />
    </ul>
    <UiHint
      v-if="filesTruncated || changedFilesCapped"
      size="xs"
      leading="inherit"
      :space-before="2"
      class="note"
    >
      Показано {{ files.length }} из {{ totalFiles }} файлов. Остальные — на {{ host }}.
    </UiHint>
    <UiHint
      v-if="filesTruncated && files.length"
      size="xs"
      leading="inherit"
      :space-before="2"
      class="note"
    >
      Суммы +/− посчитаны по показанным файлам.
    </UiHint>
    <UiHint v-if="!diffRefs" size="xs" leading="inherit" :space-before="2" class="note">
      Diff файлов этого источника пока недоступен. Изменённые файлы можно посмотреть на {{ host }}.
    </UiHint>
  </section>
</template>

<style scoped>
.changes {
  margin-top: var(--sp-4);
}
.head {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: var(--sp-2);
  margin-bottom: var(--sp-2);
}
.count {
  color: var(--faint);
  font: var(--fs-2xs) var(--mono);
}
.totals {
  margin-left: auto;
  font: var(--fs-2xs) var(--mono);
}
.tree-button {
  display: inline-flex;
  align-items: center;
  gap: var(--sp-1);
  padding: 2px var(--sp-2);
  border: 1px solid var(--line);
  border-radius: var(--r-sm);
  color: var(--muted);
  font-size: var(--fs-2xs);
}
.tree-button:hover {
  color: var(--text);
  border-color: var(--line-strong);
}
.tree-button svg {
  width: 13px;
  height: 13px;
}
.file-list {
  list-style: none;
  margin: 0;
  padding: 0;
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  overflow: hidden;
}
.file-list li + li {
  border-top: 1px solid var(--line);
}
.add,
.del {
  flex-shrink: 0;
  font: var(--fs-2xs) var(--mono);
}
.add {
  color: var(--run);
}
.del {
  color: var(--err);
}
</style>
