<script setup lang="ts">
import { useId } from "vue";
import UsageMeter from "./UsageMeter.vue";
import type { UsagePaceTone } from "./usage-pace.ts";
import type { UsageWindowView } from "./usage-windows.ts";

defineProps<{
  title: string;
  tooltip: string;
  remaining: number | null;
  tone: UsagePaceTone | null;
  meterLabel: string;
  rows: readonly UsageWindowView[];
  prefix?: string;
  compact?: boolean;
  interactive?: boolean;
}>();
const emit = defineEmits<{ cycle: [] }>();
const tooltipId = useId();
</script>

<template>
  <component
    :is="interactive ? 'button' : 'span'"
    :type="interactive ? 'button' : undefined"
    :tabindex="interactive ? undefined : 0"
    class="usage-indicator"
    :class="[tone ? `tone-${tone}` : undefined, { interactive }]"
    :aria-label="tooltip"
    :aria-describedby="tooltipId"
    @click="interactive && emit('cycle')"
  >
    <span class="usage-icon" aria-hidden="true"><slot name="icon" /></span>
    <UsageMeter
      :remaining="remaining"
      :prefix="prefix"
      :compact="compact"
      :tone="tone"
      :aria-label="meterLabel"
    />
    <span :id="tooltipId" class="quota-tooltip" role="tooltip">
      <template v-if="rows.length">
        <span class="tooltip-heading">{{ title }} · сброс через</span>
        <span v-for="row in rows" :key="row.name" class="quota-row">
          <span>{{ row.label }}</span>
          <UsageMeter
            :remaining="row.remaining"
            :countdown="row.countdown"
            :exhausted="row.limited"
            :ticks="row.ticks"
            :tone="row.tone"
          />
        </span>
        <span v-if="interactive" class="tooltip-hint">Клик — сменить лимит</span>
      </template>
      <template v-else>{{ tooltip }}</template>
    </span>
  </component>
</template>

<style scoped>
.usage-indicator {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
  outline-offset: 2px;
}
.interactive {
  min-height: 24px;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
}
.tone-spare {
  color: var(--info);
}
.tone-normal {
  color: var(--muted);
}
.tone-hot {
  color: var(--warn);
}
.tone-over {
  color: var(--err);
}
.usage-icon {
  display: inline-flex;
}
.usage-icon :deep(svg) {
  width: 13px;
  height: 13px;
}
.tooltip-heading {
  display: block;
  margin-bottom: 5px;
}
.quota-row {
  display: grid;
  grid-template-columns: 26px 160px;
  align-items: center;
  gap: 6px;
  margin-bottom: 4px;
}
.quota-row:last-child {
  margin-bottom: 0;
}
.tooltip-hint {
  display: block;
  margin-top: 5px;
  color: var(--muted);
}
.quota-tooltip {
  position: absolute;
  z-index: 30;
  right: 0;
  bottom: calc(100% + 7px);
  padding: 7px 9px;
  border: 1px solid var(--line);
  border-radius: 5px;
  background: var(--bg-raised, var(--bg));
  color: var(--text);
  white-space: pre-line;
  overflow-wrap: anywhere;
  width: max-content;
  max-width: min(340px, 80vw);
  box-shadow: 0 3px 12px #0002;
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
}
.usage-indicator:hover .quota-tooltip,
.usage-indicator:focus-visible .quota-tooltip {
  opacity: 1;
  visibility: visible;
}
</style>
