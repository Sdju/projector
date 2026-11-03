<script setup lang="ts">
import UiButton from "../../../../../common/ui/UiButton.vue";
import UiHeading from "../../../../../common/ui/UiHeading.vue";
import UiHint from "../../../../../common/ui/UiHint.vue";
import { computed } from "vue";
import type {
  PullRequestComparison,
  PullRequestDiffRefs,
  PullRequestFile,
} from "../../../../../../core/modules/workspace/index.ts";
import { FileIcon, useFileIconTheme } from "../../../../file-icons/index.ts";
import CommitFileDiff from "./CommitFileDiff.vue";
import IconChevronRight from "~icons/lucide/chevron-right";
import IconOpen from "~icons/lucide/external-link";
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
const files = computed(() =>
  props.files.map((file) => ({
    ...file,
    name: file.path.split("/").at(-1)!,
    directory: file.path.split("/").slice(0, -1).join("/"),
    icon: resolver.value.resolve(
      { name: file.path.split("/").at(-1)!, path: file.path, directory: false },
      false,
    ),
    share: file.additions + file.deletions ? file.additions / (file.additions + file.deletions) : 0,
    text: !file.binary && !file.tooLarge,
  })),
);
const textFiles = computed(() => files.value.filter((file) => file.text));
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
      <li v-for="file in files" :key="file.path">
        <div class="file-row">
          <button
            type="button"
            class="file"
            :disabled="!diffRefs || !file.text"
            :aria-expanded="diffRefs && file.text ? expanded.has(file.path) : undefined"
            :title="
              !diffRefs
                ? 'Diff недоступен'
                : file.binary
                  ? 'Бинарный файл'
                  : file.tooLarge
                    ? 'Файл слишком большой для diff'
                    : 'Показать изменения'
            "
            @click="diffRefs && file.text && emit('toggle', file.path)"
          >
            <span class="glyph" aria-hidden="true">
              <IconChevronRight
                v-if="diffRefs && file.text"
                :class="{ open: expanded.has(file.path) }"
              />
            </span>
            <b class="status" :class="file.status">{{ MARK[file.status] }}</b>
            <FileIcon :icon="file.icon" />
            <span class="name">{{ file.name }}</span>
            <span class="dir u-truncate">
              <template v-if="file.previousPath">{{ file.previousPath }} → </template
              >{{ file.directory }}
            </span>
            <span v-if="file.binary" class="muted">бинарный</span>
            <span v-else-if="file.tooLarge" class="muted">большой</span>
            <span v-else-if="file.generated" class="muted">сгенерирован</span>
            <template v-else>
              <span v-if="file.additions + file.deletions" class="bar" aria-hidden="true">
                <i :style="{ width: `${file.share * 100}%` }" />
              </span>
              <span class="add">+{{ file.additions }}</span>
              <span class="del">−{{ file.deletions }}</span>
            </template>
          </button>
          <UiButton
            v-if="diffRefs && file.text"
            shape="icon"
            size="sm"
            title="Открыть изменения во вкладке"
            :aria-label="`Открыть изменения во вкладке: ${file.path}`"
            data-command="ide.mergeRequest.file.open"
            @click="emit('open', file.path)"
          >
            <IconOpen aria-hidden="true" />
          </UiButton>
        </div>
        <div v-if="expanded.has(file.path)" class="inline">
          <UiHint
            v-if="diffs[file.path]?.loading"
            size="xs"
            leading="inherit"
            class="note"
            role="status"
            >загрузка…</UiHint
          >
          <UiHint
            v-else-if="diffs[file.path]?.error"
            size="xs"
            leading="inherit"
            class="note error"
            role="alert"
          >
            {{ diffs[file.path]!.error }}
          </UiHint>
          <UiHint
            v-else-if="diffs[file.path]?.data?.tooLarge"
            size="xs"
            leading="inherit"
            class="note"
            >Файл слишком большой для diff. Откройте его на {{ host }}.</UiHint
          >
          <UiHint
            v-else-if="diffs[file.path]?.data?.binary"
            size="xs"
            leading="inherit"
            class="note"
            >Бинарный файл: diff не показывается.</UiHint
          >
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
.muted {
  color: var(--muted);
  font-size: var(--fs-2xs);
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
  opacity: 0.8;
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
.inline {
  border-top: 1px solid var(--line);
}
.inline .note {
  margin: 0;
  padding: var(--sp-2) var(--sp-3);
}
.note.error {
  color: var(--err);
}
</style>
