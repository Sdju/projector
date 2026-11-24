<script setup lang="ts">
import { computed } from "vue";
import ProjectorIcon from "../../../../common/icons/ProjectorIcon.vue";
import UsageIndicator from "../../_/UsageIndicator.vue";
import { useAntigravityUsageIndicator } from "../model/usage.ts";

const { usage, refreshing, selected, remaining, tone, tooltipRows, tooltip, commands } =
  useAntigravityUsageIndicator();

const displayTooltip = computed(() =>
  refreshing.value ? 'Antigravity · проверка лимитов (agy -p "/usage")…' : tooltip.value,
);

function onPrimaryClick(): void {
  if (usage.value?.status === "ready" && tooltipRows.value.length) {
    void commands.run("ide.antigravity.usage.window.cycle");
    return;
  }
  void commands.run("ide.antigravity.usage.refresh");
}
</script>

<template>
  <span class="antigravity-usage-wrap">
    <UsageIndicator
      class="antigravity-usage"
      title="Antigravity"
      :tooltip="displayTooltip"
      :remaining="remaining"
      :tone="tone"
      :prefix="selected.shortLabel"
      :meter-label="`Остаток лимита Antigravity: ${selected.label}`"
      :rows="tooltipRows"
      interactive
      @cycle="onPrimaryClick"
    >
      <template #icon><ProjectorIcon name="simple-icons:antigravity" /></template>
    </UsageIndicator>
    <button
      type="button"
      class="antigravity-refresh"
      :disabled="refreshing"
      title='Обновить лимиты Antigravity вручную (agy -p "/usage")'
      aria-label="Обновить лимиты Antigravity вручную"
      @click="commands.run('ide.antigravity.usage.refresh')"
    >
      <ProjectorIcon name="refresh-cw" class="refresh-icon" :class="{ spinning: refreshing }" />
    </button>
  </span>
</template>

<style scoped>
.antigravity-usage-wrap {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
}
.antigravity-refresh {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  padding: 0;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--muted);
  cursor: pointer;
}
.antigravity-refresh:hover:not(:disabled) {
  color: var(--text);
  background: var(--bg-hover, #ffffff10);
}
.antigravity-refresh:disabled {
  opacity: 0.55;
  cursor: default;
}
.refresh-icon {
  width: 11px;
  height: 11px;
}
.spinning {
  animation: agy-spin 1s linear infinite;
}
@keyframes agy-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
