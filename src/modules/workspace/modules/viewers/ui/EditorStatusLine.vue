<script setup lang="ts">
import UiInline from "../../../../../common/ui/UiInline.vue";
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
  <UiInline as="footer" :gap="3" justify="normal" class="editor-status-line">
    <span v-if="status.active" class="item u-truncate" title="Позиция каретки">
      Строка {{ status.line }}, столбец {{ status.column }}
    </span>
    <span v-if="selection" class="item u-truncate">{{ selection }}</span>
    <span class="spacer" />
    <span class="item u-truncate" title="Язык подсветки синтаксиса">{{ language }}</span>
    <span class="item u-truncate" :title="`Перевод строк документа: ${lineEnding}`">{{
      lineEnding
    }}</span>
  </UiInline>
</template>

<style scoped>
.editor-status-line {
  flex: none;
  min-height: 22px;
  padding-inline: var(--sp-3);
  border-top: 1px solid var(--line);
  color: var(--muted);
  font: var(--fs-2xs) var(--sans);
  user-select: none;
}

.spacer {
  flex: 1;
}
</style>
