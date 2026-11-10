<script setup lang="ts">
import UiHint from "../../../../../common/ui/UiHint.vue";
import { computed } from "vue";
import type {
  CommitComparison,
  GitCommitDetail,
} from "@ai-projector/core/modules/workspace/index.ts";
import UiButton from "../../../../../common/ui/UiButton.vue";
import { useFileIconTheme } from "../../../../file-icons/index.ts";
import ChangedFileRow from "./ChangedFileRow.vue";
import type { ChangedFileItem } from "../lib/changed-files.ts";

/** Файлы коммита с числом строк; текстовые раскрываются в код изменений. */
const props = defineProps<{
  detail: GitCommitDetail;
  expanded: Set<string>;
  heights: Record<string, number>;
  diffs: Record<string, { loading: boolean; error: string; data?: CommitComparison }>;
}>();
const emit = defineEmits<{
  toggle: [path: string, open?: boolean];
  toggleAll: [];
  openDiff: [path: string];
  resize: [path: string, height: number];
}>();
const { resolver } = useFileIconTheme();
const textFiles = computed(() => props.detail.files.filter((file) => !file.binary));
const files = computed<ChangedFileItem[]>(() =>
  props.detail.files.map((file) => {
    const name = file.path.split("/").at(-1)!;
    return {
      path: file.path,
      name,
      directory: file.path.split("/").slice(0, -1).join("/"),
      icon: resolver.value.resolve({ name, path: file.path, directory: false }, false),
      previousPath: file.originalPath,
      mark: file.status,
      additions: file.additions,
      deletions: file.deletions,
      binary: file.binary,
      expandable: !file.binary,
      openable: !file.binary,
      disabledTitle: file.binary ? "Бинарный файл" : "Показать код",
      // Share of changed lines that are additions; binary files have no bar.
      share:
        file.additions + file.deletions ? file.additions / (file.additions + file.deletions) : 0,
    };
  }),
);
</script>

<template>
  <div>
    <h3>
      Файлы <span>{{ files.length }}</span>
      <b class="add">+{{ detail.additions }}</b>
      <b class="del">−{{ detail.deletions }}</b>
      <UiButton
        v-if="textFiles.length"
        size="sm"
        class="all"
        data-command="ide.git.commit.files.toggleAll"
        @click="emit('toggleAll')"
      >
        {{ expanded.size ? "Свернуть всё" : "Развернуть всё" }}
      </UiButton>
    </h3>
    <UiHint
      size="xs"
      leading="inherit"
      :space-after="2"
      v-if="detail.parents.length > 1"
      class="note"
    >
      Слияние: показаны изменения относительно первого родителя.
    </UiHint>
    <UiHint size="xs" leading="inherit" :space-after="2" v-if="!files.length" class="note"
      >В этой папке коммит ничего не менял.</UiHint
    >
    <ul v-else class="files">
      <ChangedFileRow
        v-for="file in files"
        :key="file.path"
        :file="file"
        :expanded="expanded.has(file.path)"
        :diff="diffs[file.path]"
        :height="heights[file.path]"
        toggle-command="ide.git.commit.file.toggle"
        open-command="ide.git.commit.openDiff"
        @toggle="(open) => emit('toggle', file.path, open)"
        @open="emit('openDiff', file.path)"
        @resize="emit('resize', file.path, $event)"
      />
    </ul>
  </div>
</template>

<style scoped>
h3 {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin: var(--sp-4) 0 var(--sp-2);
  font-size: var(--fs-2xs);
  letter-spacing: var(--track-label);
  text-transform: uppercase;
  font-weight: 500;
  color: var(--muted);
}
h3 span {
  color: var(--faint);
}
.files {
  list-style: none;
  margin: 0;
  padding: 0;
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  overflow: hidden;
}
.files li + li {
  border-top: 1px solid var(--line);
}
.all {
  margin-left: auto;
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
