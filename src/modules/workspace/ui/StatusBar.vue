<script setup lang="ts">
import { AgentUsageIndicators } from "../../agents-integration/status-bar/index.ts";
</script>

<template>
  <footer class="status-bar">
    <span class="status-spacer" />
    <AgentUsageIndicators />
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
.status-spacer {
  flex: 1;
}
@media (max-width: 600px) {
  .status-bar {
    flex-wrap: wrap;
    gap: 6px;
    padding-inline: 6px;
  }
  .status-spacer {
    display: none;
  }
  .status-bar :deep(.quota-bar:not(.tooltip-bar)) {
    min-width: 64px;
  }
}
</style>
