<script setup lang="ts">
import UiDisclosureSummary from "../../../common/ui/UiDisclosureSummary.vue";
import { computed } from "vue";
import { formatElapsed, useElapsedClock } from "../../agent-core/index.ts";
import { inputHint } from "../../agent-core/index.ts";
import { skillCallName, toolLabel } from "../../agent-core/index.ts";
import type { AgentToolView } from "../../agent-core/index.ts";
import AgentCodeBlock from "./AgentCodeBlock.vue";
import AgentStatusIcon from "./AgentStatusIcon.vue";
import AgentToolCall from "./AgentToolCall.vue";
import IconChevron from "~icons/lucide/chevron-right";

const props = defineProps<{ tools: AgentToolView[]; root?: string }>();
const emit = defineEmits<{ open: [path: string] }>();
const current = computed(() => props.tools.findLast((tool) => tool.status === "running"));
const live = computed(() => current.value?.output ?? "");
// The group stays a single row, so a running command shows just the newest lines of its output.
const tail = computed(() =>
  live.value
    .split("\n")
    .slice(-6)
    .filter((line, index, lines) => line || index < lines.length - 1)
    .join("\n"),
);
const failed = computed(() => props.tools.some((tool) => tool.status === "error"));
const hint = computed(() => {
  const tool = current.value;
  if (!tool) return "";
  const raw = tool.input ?? tool.detail;
  return skillCallName(tool.name, raw) ? "" : inputHint(raw);
});
const now = useElapsedClock();
const currentTime = computed(() => {
  const tool = current.value;
  if (!tool || tool.startedAt === undefined) return "";
  return formatElapsed(now.value - tool.startedAt);
});
// A finished group of one kind of call reads as "Запись файла ×2"; a mixed one, as a count.
const title = computed(() => {
  if (current.value)
    return toolLabel(current.value.name, current.value.input ?? current.value.detail);
  const names = new Set(props.tools.map((tool) => tool.name));
  const first = props.tools[0]!;
  return names.size === 1
    ? `${toolLabel(first.name, first.input ?? first.detail)} ×${props.tools.length}`
    : "Действия";
});
</script>

<template>
  <div v-if="tools.length === 1" class="activity single">
    <AgentToolCall :tool="tools[0]!" :root="root" @open="emit('open', $event)" />
  </div>
  <details v-else class="activity" :class="{ working: current, failed }">
    <UiDisclosureSummary variant="fit" class="activity-summary">
      <AgentStatusIcon :status="current ? 'running' : failed ? 'error' : 'done'" />
      <span class="activity-title u-truncate" :title="title">{{ title }}</span>
      <span v-if="current" class="tool-hint u-truncate" :title="hint">{{ hint }}</span>
      <span v-if="currentTime" class="tool-time" :title="`Выполняется ${currentTime}`">{{
        currentTime
      }}</span>
      <span v-if="current || title === 'Действия'" class="count">{{ tools.length }}</span>
      <IconChevron class="group-chevron" aria-hidden="true" />
    </UiDisclosureSummary>
    <AgentCodeBlock v-if="tail" :text="tail" />
    <div class="activity-list">
      <AgentToolCall
        v-for="tool in tools"
        :key="tool.id"
        :tool="tool"
        :root="root"
        @open="emit('open', $event)"
      />
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
svg {
  width: 13px;
  height: 13px;
  flex-shrink: 0;
}
.activity-title {
  min-width: 0;
}
.count {
  flex-shrink: 0;
  color: var(--faint);
}
.tool-time {
  flex-shrink: 0;
  color: var(--faint);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.tool-hint {
  min-width: 0;
  max-width: 40ch;
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
@media (prefers-reduced-motion: reduce) {
  .group-chevron {
    transition: none;
  }
}
</style>
