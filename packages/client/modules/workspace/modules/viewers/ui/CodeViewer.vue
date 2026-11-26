<script setup lang="ts">
import ProjectorIcon from "../../../../../common/icons/ProjectorIcon.vue";
import UiButton from "../../../../../common/ui/UiButton.vue";
import UiPanel from "../../../../../common/ui/UiPanel.vue";
import { ref } from "vue";
import { useCodeEditor } from "../lib/code-editor.ts";
import EditorTopbarActions from "./EditorTopbarActions.vue";

const props = defineProps<{
  path: string;
  content: string;
  original?: string;
  originalLabel?: string;
  modifiedLabel?: string;
  line?: number;
  /** With `line`, selects the whole range when the file opens. */
  endLine?: number;
  column?: number;
  editable?: boolean;
  projectId?: string;
  revision?: number;
  /** Git index side of a local diff; remarks of a review open this side. */
  staged?: boolean;
}>();
const emit = defineEmits<{ change: [content: string]; save: []; ready: [] }>();
const container = ref<HTMLElement>();
const {
  sideBySide,
  collapseUnchanged,
  review,
  fileReviewCount,
  totalReviewCount,
  showReviewIndicator,
  focusOut,
} = useCodeEditor(props, container, {
  onChange: (content) => emit("change", content),
  onSave: () => emit("save"),
  onReady: () => emit("ready"),
});
</script>
<template>
  <UiPanel as="div" class="code-viewer-root">
    <EditorTopbarActions v-if="showReviewIndicator">
      <UiButton
        size="sm"
        appearance="quiet"
        class="review-topbar-btn"
        :class="{ active: fileReviewCount > 0 }"
        :title="
          fileReviewCount > 0
            ? `Замечаний в файле: ${fileReviewCount} (всего в ревью: ${totalReviewCount}). Открыть ревью`
            : `Замечаний в ревью: ${totalReviewCount}. Открыть ревью`
        "
        data-command="ide.review.open"
        @click="review?.open()"
      >
        <ProjectorIcon name="message-square" class="review-topbar-icon" aria-hidden="true" />
        <span>{{ fileReviewCount > 0 ? fileReviewCount : totalReviewCount }}</span>
      </UiButton>
    </EditorTopbarActions>
    <div v-if="original !== undefined" class="diff-layout" role="group" aria-label="Вид сравнения">
      <button
        type="button"
        :title="sideBySide ? 'В одну колонку' : 'Две колонки'"
        :aria-label="sideBySide ? 'В одну колонку' : 'Две колонки'"
        :aria-pressed="sideBySide"
        @click="sideBySide = !sideBySide"
      >
        <ProjectorIcon name="rows-2" v-if="sideBySide" />
        <ProjectorIcon name="columns-2" v-else />
      </button>
      <button
        type="button"
        :title="
          collapseUnchanged ? 'Развернуть неизменённые строки' : 'Свернуть неизменённые строки'
        "
        :aria-label="
          collapseUnchanged ? 'Развернуть неизменённые строки' : 'Свернуть неизменённые строки'
        "
        :aria-pressed="collapseUnchanged"
        @click="collapseUnchanged = !collapseUnchanged"
      >
        <ProjectorIcon name="unfold-vertical" v-if="collapseUnchanged" />
        <ProjectorIcon name="fold-vertical" v-else />
      </button>
    </div>
    <div v-if="original !== undefined" class="diff-header">
      <span class="diff-side u-truncate">{{ originalLabel ?? "Было" }}</span>
      <span class="diff-arrow" v-if="!sideBySide">→</span>
      <span class="diff-side u-truncate">{{ modifiedLabel ?? "Стало" }}</span>
    </div>
    <div
      ref="container"
      class="code-viewer"
      @focusout="focusOut"
      :aria-label="editable ? 'Редактор файла' : 'Просмотр кода'"
    />
  </UiPanel>
</template>
<style scoped>
.code-viewer-root {
  position: relative;
}
.review-topbar-btn {
  min-height: 22px;
  padding: 0 7px;
  gap: 4px;
  font: var(--fs-2xs) var(--mono);
  color: var(--muted);
}
.review-topbar-btn.active {
  color: var(--accent);
}
.review-topbar-icon {
  width: 12px;
  height: 12px;
}
.diff-header {
  display: flex;
  flex: none;
  align-items: center;
  height: 24px;
  border-bottom: 1px solid var(--line);
  color: var(--muted);
  font: var(--fs-xs) var(--sans);
}
.diff-side {
  flex: 1;
  min-width: 0;
  padding: 0 12px;
}
.diff-side + .diff-side {
  border-left: 1px solid var(--line);
}
.diff-arrow {
  flex: none;
}
.diff-layout {
  position: absolute;
  top: 2px;
  right: 18px;
  z-index: 5;
  display: flex;
  gap: 2px;
}
.diff-layout button {
  display: grid;
  place-items: center;
  width: 20px;
  height: 20px;
  padding: 0;
  border: 0;
  border-radius: var(--r-sm);
  background: transparent;
  color: var(--muted);
  cursor: pointer;
}
.diff-layout button:hover,
.diff-layout button.active {
  background: var(--active);
  color: var(--text);
}
.code-viewer :deep(.cm-mergeView),
.code-viewer :deep(.cm-mergeViewEditors) {
  height: 100%;
}
.code-viewer :deep(.cm-mergeViewEditor) {
  height: 100%;
  min-width: 0;
  overflow: hidden;
}
.code-viewer :deep(.cm-mergeViewEditor + .cm-mergeViewEditor) {
  border-left: 1px solid var(--line);
}
.code-viewer :deep(.cm-mergeView .cm-editor) {
  height: 100%;
}
.code-viewer {
  flex: 1;
  height: auto;
  min-height: 0;
  overflow: hidden;
}
[data-theme-effects] .code-viewer :deep(.cm-editor),
[data-theme-effects] .code-viewer :deep(.cm-gutters) {
  background-color: var(--theme-panel-background);
}
.code-viewer :deep(.selection-actions) {
  display: flex;
  gap: 4px;
}
.code-viewer :deep(.selection-chat) {
  display: inline-flex;
  align-items: center;
  min-height: 26px;
  padding: 0 10px;
  border: 1px solid var(--line-strong);
  border-radius: var(--r-full);
  background: var(--bg-3);
  box-shadow: var(--shadow-popover);
  color: var(--text);
  font: var(--fs-xs) var(--sans);
  cursor: pointer;
}
.code-viewer :deep(.selection-chat:hover) {
  background: var(--bg-4);
}
.code-viewer :deep(.selection-chat:focus-visible) {
  border-color: var(--focus);
  background: var(--bg-4);
}
.code-viewer :deep(.selection-review) {
  border-color: color-mix(in srgb, var(--accent) 55%, var(--line-strong));
}
.code-viewer :deep(.cm-dirty-gutter) {
  width: 10px;
}
.code-viewer :deep(.git-gutter-added),
.code-viewer :deep(.git-gutter-modified) {
  height: 100%;
  margin-left: 3px;
  width: 3px;
  cursor: pointer;
  background: var(--run);
}
.code-viewer :deep(.git-gutter-modified) {
  background: var(--info);
}
.code-viewer :deep(.git-gutter-deleted) {
  margin-left: 3px;
  width: 0;
  height: 0;
  margin-top: 100%;
  border-left: 4px solid var(--err);
  border-top: 4px solid transparent;
  border-bottom: 4px solid transparent;
}
.code-viewer :deep(.git-gutter-deleted-top) {
  margin-top: 0;
}
.code-viewer :deep(.dirty-diff-peek) {
  box-sizing: border-box;
  overflow: hidden;
  border-top: 1px solid var(--line);
  border-bottom: 1px solid var(--line);
  background: var(--bg-2);
}
.code-viewer :deep(.dirty-diff-bar) {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 0 8px;
  height: 20px;
  color: var(--muted);
  font: var(--fs-xs) var(--sans);
}
.code-viewer :deep(.dirty-diff-title) {
  flex: 1;
}
.code-viewer :deep(.dirty-diff-button) {
  min-width: 20px;
  height: 18px;
  border: 0;
  border-radius: var(--r-sm);
  background: transparent;
  color: inherit;
  font: inherit;
  line-height: 1;
  cursor: pointer;
}
.code-viewer :deep(.dirty-diff-button:hover) {
  background: var(--active);
  color: var(--text);
}
.code-viewer :deep(.dirty-diff-body) {
  padding: 0 0 0 64px;
  background: color-mix(in srgb, var(--err) 8%, transparent);
  font: var(--fs-sm) var(--mono);
  white-space: pre;
  line-height: 20px;
}
.code-viewer :deep(.cm-changedLine) {
  background: color-mix(in srgb, var(--run) 8%, transparent);
}
.code-viewer :deep(.cm-changedText) {
  background: color-mix(in srgb, var(--run) 20%, transparent);
}
.code-viewer :deep(.diff-revert) {
  margin: 0 4px;
  padding: 0 6px;
  border: 1px solid var(--line);
  border-radius: var(--r-sm);
  background: var(--bg-2);
  color: var(--muted);
  font: var(--fs-xs) var(--sans);
  cursor: pointer;
}
.code-viewer :deep(.diff-revert:hover) {
  background: var(--active);
  color: var(--text);
}
.code-viewer :deep(.cm-deletedChunk) {
  background: color-mix(in srgb, var(--err) 8%, transparent);
}
</style>
