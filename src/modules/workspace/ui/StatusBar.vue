<script setup lang="ts">
import { computed } from "vue";
import { AgentUsageIndicators } from "../../agents-integration/status-bar/index.ts";
import { useEditorStatus } from "../modules/viewers/index.ts";

const status = useEditorStatus();

const selection = computed(() => {
  if (!status.selectedChars) return "";
  const lines = status.selectedLines > 1 ? ` · ${status.selectedLines} строк` : "";
  return `выделено ${status.selectedChars} симв.${lines}`;
});
</script>

<template>
  <footer class="status-bar">
    <div class="status-group">
      <span v-if="status.active" class="status-item" title="Позиция каретки">
        Строка {{ status.line }}, столбец {{ status.column }}
      </span>
      <span v-if="selection" class="status-item">{{ selection }}</span>
    </div>
    <div class="status-spacer" />
    <AgentUsageIndicators />
    <span
      v-if="status.active && status.lineEnding"
      class="status-item"
      :title="`Перевод строки документа: ${status.lineEnding}`"
      >{{ status.lineEnding }}</span
    >
  </footer>
</template>

<style scoped>
.status-bar {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  min-height: 24px;
  padding-inline: var(--sp-2);
  color: var(--muted);
  font-size: var(--fs-2xs);
  user-select: none;
}
.status-group {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  min-width: 0;
  overflow: hidden;
}
.status-item {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.status-spacer {
  flex: 1;
}
@media (max-width: 600px) {
  .status-bar {
    flex-wrap: wrap;
    gap: 6px;
    padding-inline: 6px;
  }
  .status-spacer,
  .status-group:empty {
    display: none;
  }
  .status-group:not(:empty) {
    flex-basis: 100%;
  }
  .status-bar :deep(.quota-bar:not(.tooltip-bar)) {
    min-width: 64px;
  }
}
</style>
