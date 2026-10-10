<script setup lang="ts">
import { computed } from "vue";
import { inputHint } from "../lib/tool-input.ts";
import { toolLabel } from "../lib/tool-labels.ts";
import type { AgentToolChip } from "../model/types.ts";
import AgentToolCall from "./AgentToolCall.vue";
import IconChevron from "~icons/lucide/chevron-right";
import IconCheck from "~icons/lucide/check";
import IconLoader from "~icons/lucide/loader-circle";
import IconAlert from "~icons/lucide/circle-alert";

const props = defineProps<{ tools: AgentToolChip[] }>();
const current = computed(() => props.tools.findLast((tool) => tool.status === "running"));
const failed = computed(() => props.tools.some((tool) => tool.status === "error"));
const hint = computed(() => {
  const tool = current.value;
  return tool ? inputHint(tool.input ?? tool.detail) : "";
});
// A finished group of one kind of call reads as "Запись файла ×2"; a mixed one, as a count.
const title = computed(() => {
  if (current.value) return toolLabel(current.value.name);
  const names = new Set(props.tools.map((tool) => tool.name));
  return names.size === 1
    ? `${toolLabel(props.tools[0]!.name)} ×${props.tools.length}`
    : "Действия";
});
</script>

<template>
  <div v-if="tools.length === 1" class="activity single">
    <AgentToolCall :tool="tools[0]!" />
  </div>
  <details v-else class="activity" :class="{ working: current, failed }">
    <summary class="activity-summary">
      <IconLoader v-if="current" class="spin" aria-hidden="true" />
      <IconAlert v-else-if="failed" class="error-icon" aria-hidden="true" />
      <IconCheck v-else class="done-icon" aria-hidden="true" />
      <span>{{ title }}</span>
      <span v-if="current" class="tool-hint" :title="hint">{{ hint }}</span>
      <span v-if="current || title === 'Действия'" class="count">{{ tools.length }}</span>
      <IconChevron class="group-chevron" aria-hidden="true" />
    </summary>
    <div class="activity-list">
      <AgentToolCall v-for="tool in tools" :key="tool.id" :tool="tool" />
    </div>
  </details>
</template>

<style scoped>
.activity {
  margin: 0 0 var(--sp-3);
  max-width: 100%;
  color: var(--muted);
  font-size: var(--fs-2xs);
}
.activity:last-child {
  margin-bottom: 0;
}
summary {
  list-style: none;
  cursor: pointer;
}
summary::-webkit-details-marker {
  display: none;
}
summary:focus-visible {
  outline-offset: 3px;
  border-radius: var(--r-md);
}
.activity-summary {
  display: flex;
  max-width: 100%;
  width: fit-content;
  align-items: center;
  gap: 7px;
  padding: 5px 0;
}
.activity-summary:hover {
  color: var(--text);
}
svg {
  width: 13px;
  height: 13px;
  flex-shrink: 0;
}
.count {
  color: var(--faint);
}
.tool-hint {
  min-width: 0;
  max-width: 40ch;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--faint);
}
.group-chevron {
  width: 12px;
  transition: transform var(--t-fast);
}
.activity[open] > summary .group-chevron {
  transform: rotate(90deg);
}
.activity-list {
  margin-top: var(--sp-1);
  padding-left: var(--sp-3);
  border-left: 1px solid var(--line);
}
.done-icon {
  color: var(--run);
}
.error-icon {
  color: var(--err);
}
.spin {
  animation: spin 1s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
@media (prefers-reduced-motion: reduce) {
  .spin {
    animation: none;
  }
  .group-chevron {
    transition: none;
  }
}
</style>
