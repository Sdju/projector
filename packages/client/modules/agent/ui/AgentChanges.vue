<script setup lang="ts">
import UiDisclosureSummary from "../../../common/ui/UiDisclosureSummary.vue";
import { computed } from "vue";
import UiButton from "../../../common/ui/UiButton.vue";
import { turnChanges } from "../lib/turn-changes.ts";
import type { AgentToolChip } from "../model/types.ts";
import IconFileDiff from "~icons/lucide/file-diff";
import IconUndo from "~icons/lucide/undo-2";

const props = defineProps<{ tools: AgentToolChip[]; root: string; canRevert: boolean }>();
const emit = defineEmits<{ open: [path: string]; revert: [] }>();
const changes = computed(() => turnChanges(props.tools, props.root));
const totals = computed(() => ({
  added: changes.value.reduce((sum, change) => sum + change.added, 0),
  removed: changes.value.reduce((sum, change) => sum + change.removed, 0),
}));
</script>

<template>
  <details v-if="changes.length" class="changes">
    <UiDisclosureSummary>
      <IconFileDiff aria-hidden="true" />
      <span>Изменено файлов: {{ changes.length }}</span>
      <span class="added">+{{ totals.added }}</span>
      <span class="removed">−{{ totals.removed }}</span>
    </UiDisclosureSummary>
    <ul>
      <li v-for="change in changes" :key="change.path">
        <button
          type="button"
          class="file u-truncate"
          :title="change.path"
          @click="emit('open', change.path)"
        >
          {{ change.path }}
        </button>
        <span class="added">+{{ change.added }}</span>
        <span class="removed">−{{ change.removed }}</span>
      </li>
    </ul>
    <UiButton
      v-if="canRevert"
      size="sm"
      title="Вернуть файлы к состоянию до этого запроса"
      @click="emit('revert')"
    >
      <IconUndo aria-hidden="true" />Вернуть файлы
    </UiButton>
  </details>
</template>

<style scoped>
.changes {
  margin-top: var(--sp-3);
  color: var(--muted);
  font-size: var(--fs-2xs);
}
svg {
  width: 13px;
  height: 13px;
  flex-shrink: 0;
}
ul {
  margin: var(--sp-1) 0 var(--sp-2);
  padding: 0;
  list-style: none;
}
li {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  min-width: 0;
  padding: 2px 0;
}
.file {
  min-width: 0;
  flex: 1;
  text-align: left;
  direction: rtl;
  font: var(--fs-2xs) var(--mono);
  color: var(--text-2);
}
.file:hover {
  color: var(--text);
  text-decoration: underline;
}
.added {
  color: var(--run);
  font-family: var(--mono);
}
.removed {
  color: var(--err);
  font-family: var(--mono);
}
</style>
