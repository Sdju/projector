<script setup lang="ts">
import { computed } from "vue";
import type {
  CommitComparison,
  GitCommitDetail,
} from "../../../../../../core/modules/workspace/index.ts";
import UiButton from "../../../../../common/ui/UiButton.vue";
import { FileIcon, useFileIconTheme } from "../../../../file-icons/index.ts";
import CommitFileDiff from "./CommitFileDiff.vue";
import IconChevronRight from "~icons/lucide/chevron-right";
import IconOpen from "~icons/lucide/external-link";

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
const files = computed(() =>
  props.detail.files.map((file) => ({
    ...file,
    name: file.path.split("/").at(-1)!,
    directory: file.path.split("/").slice(0, -1).join("/"),
    icon: resolver.value.resolve(
      { name: file.path.split("/").at(-1)!, path: file.path, directory: false },
      false,
    ),
    // Share of changed lines that are additions; binary files have no bar.
    share: file.additions + file.deletions ? file.additions / (file.additions + file.deletions) : 0,
  })),
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
    <p v-if="detail.parents.length > 1" class="note">
      Слияние: показаны изменения относительно первого родителя.
    </p>
    <p v-if="!files.length" class="note">В этой папке коммит ничего не менял.</p>
    <ul v-else class="files">
      <li v-for="file in files" :key="file.path">
        <div class="file-row">
          <button
            class="file"
            :disabled="file.binary"
            :aria-expanded="file.binary ? undefined : expanded.has(file.path)"
            :title="file.binary ? 'Бинарный файл' : 'Показать код'"
            data-command="ide.git.commit.file.toggle"
            @click="emit('toggle', file.path)"
          >
            <span class="glyph" aria-hidden="true">
              <IconChevronRight v-if="!file.binary" :class="{ open: expanded.has(file.path) }" />
            </span>
            <b class="status" :class="file.status">{{ file.status }}</b>
            <FileIcon :icon="file.icon" />
            <span class="name">{{ file.name }}</span>
            <span class="dir">
              <template v-if="file.originalPath">{{ file.originalPath }} → </template
              >{{ file.directory }}
            </span>
            <span v-if="file.binary" class="muted">бинарный</span>
            <template v-else>
              <span v-if="file.additions + file.deletions" class="bar" aria-hidden="true">
                <i :style="{ width: `${file.share * 100}%` }" />
              </span>
              <span class="add">+{{ file.additions }}</span>
              <span class="del">−{{ file.deletions }}</span>
            </template>
          </button>
          <UiButton
            v-if="!file.binary"
            icon
            size="sm"
            title="Открыть изменения во вкладке"
            :aria-label="`Открыть изменения во вкладке: ${file.path}`"
            data-command="ide.git.commit.openDiff"
            @click="emit('openDiff', file.path)"
          >
            <IconOpen aria-hidden="true" />
          </UiButton>
        </div>
        <div v-if="expanded.has(file.path)" class="inline">
          <p v-if="diffs[file.path]?.loading" class="note" role="status">загрузка…</p>
          <p v-else-if="diffs[file.path]?.error" class="note error" role="alert">
            {{ diffs[file.path]!.error }}
          </p>
          <CommitFileDiff
            v-else-if="diffs[file.path]?.data"
            :comparison="diffs[file.path]!.data!"
            :path="file.path"
            :height="heights[file.path]"
            @resize="emit('resize', file.path, $event)"
            @collapse="emit('toggle', file.path, false)"
          />
        </div>
      </li>
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
.muted {
  color: var(--muted);
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
.file-row {
  display: flex;
  align-items: center;
  padding-right: var(--sp-2);
}
.file-row:hover {
  background: var(--hover);
}
.file {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px var(--sp-3);
  text-align: left;
  font-size: var(--fs-xs);
}
.file:disabled {
  cursor: default;
  opacity: 0.7;
}
.glyph {
  width: 12px;
  flex-shrink: 0;
  color: var(--faint);
}
.glyph svg {
  width: 12px;
  height: 12px;
  display: block;
}
.glyph svg.open {
  transform: rotate(90deg);
}
.all {
  margin-left: auto;
}
.inline {
  border-top: 1px solid var(--line);
}
.inline .note {
  margin: 0;
  padding: var(--sp-2) var(--sp-3);
}
.status {
  width: 14px;
  font: var(--fs-2xs) var(--mono);
  color: var(--run);
}
.status.D {
  color: var(--err);
}
.status.R,
.status.C {
  color: var(--accent);
}
.name {
  flex-shrink: 0;
}
.dir {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  direction: rtl;
  text-align: left;
  color: var(--faint);
  font-size: var(--fs-2xs);
}
.bar {
  width: 48px;
  height: 4px;
  flex-shrink: 0;
  border-radius: 2px;
  background: var(--err);
  overflow: hidden;
}
.bar i {
  display: block;
  height: 100%;
  background: var(--run);
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
.note {
  margin: 0 0 var(--sp-2);
  color: var(--muted);
  font-size: var(--fs-xs);
}
.error {
  color: var(--err);
}
</style>
