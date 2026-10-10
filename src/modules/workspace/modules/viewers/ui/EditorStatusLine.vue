<script setup lang="ts">
import { computed } from "vue";
import { detectLineEnding, useEditorStatusStore } from "../lib/editor-status.ts";
import { languageLabel } from "../lib/codemirror.ts";

/** Нижняя строка вкладки файла: позиция каретки, язык подсветки и перевод строк. */
const props = defineProps<{ path: string; content: string }>();

const status = useEditorStatusStore().status;

const lineEnding = computed(() => detectLineEnding(props.content));
const language = computed(() => languageLabel(props.path) ?? "Текст");
const selection = computed(() => {
  if (!status.selectedChars) return "";
  const lines = status.selectedLines > 1 ? ` · ${status.selectedLines} строк` : "";
  return `выделено ${status.selectedChars} симв.${lines}`;
});
</script>

<template>
  <footer class="editor-status-line">
    <span v-if="status.active" class="item" title="Позиция каретки">
      Строка {{ status.line }}, столбец {{ status.column }}
    </span>
    <span v-if="selection" class="item">{{ selection }}</span>
    <span class="spacer" />
    <span class="item" title="Язык подсветки синтаксиса">{{ language }}</span>
    <span class="item" :title="`Перевод строк документа: ${lineEnding}`">{{ lineEnding }}</span>
  </footer>
</template>

<style scoped>
.editor-status-line {
  display: flex;
  flex: none;
  align-items: center;
  gap: var(--sp-3);
  min-height: 22px;
  padding-inline: var(--sp-3);
  border-top: 1px solid var(--line);
  color: var(--muted);
  font: var(--fs-2xs) var(--sans);
  user-select: none;
}
.item {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.spacer {
  flex: 1;
}
</style>
