<script lang="ts">
import type { AgentToolView } from "../model/types.ts";

/** One step of a work group, in the order the answer happened: a thought or a run of calls. */
export type AgentWorkItem =
  | { key: string; type: "thought"; text: string }
  | { key: string; type: "tools"; tools: AgentToolView[] };
</script>

<script setup lang="ts">
import UiDisclosureSummary from "../../../common/ui/UiDisclosureSummary.vue";
import { computed, ref } from "vue";
import { formatElapsed, useElapsedClock } from "../lib/elapsed.ts";
import { inputHint } from "../lib/tool-input.ts";
import { toolLabel } from "../lib/tool-labels.ts";
import AgentActivity from "./AgentActivity.vue";
import AgentThought from "./AgentThought.vue";
import IconAlert from "~icons/lucide/circle-alert";
import IconCheck from "~icons/lucide/check";
import IconChevron from "~icons/lucide/chevron-right";
import UiSpinner from "../../../common/ui/UiSpinner.vue";

const props = defineProps<{
  items: AgentWorkItem[];
  busy: boolean;
  last: boolean;
  /** This group is the last one in the answer, so it may be the step being worked on. */
  current?: boolean;
  /** Some call of the answer is still running, even if it belongs to another group. */
  anyRunning?: boolean;
  root?: string;
}>();
const emit = defineEmits<{ open: [path: string] }>();

// Closed by default: the body is mounted only while it is shown, so a long answer keeps its
// thoughts and calls out of the DOM until the user asks for them.
const open = ref(false);
const toggle = (event: Event) => {
  open.value = (event.target as HTMLDetailsElement).open;
};

const running = computed(() =>
  props.items
    .flatMap((item) => (item.type === "tools" ? item.tools : []))
    .findLast((tool) => tool.status === "running"),
);
const active = computed(() => props.busy && props.last);
// The agent is reasoning when this is the work group still in progress and no call is running.
const thinking = computed(
  () => active.value && props.current === true && !running.value && props.anyRunning !== true,
);
const live = computed(() => active.value && Boolean(running.value || thinking.value));
const failed = computed(() =>
  props.items.some(
    (item) => item.type === "tools" && item.tools.some((tool) => tool.status === "error"),
  ),
);
const step = computed(() => {
  if (running.value) return toolLabel(running.value.name);
  return thinking.value ? "Думает…" : "";
});
const hint = computed(() =>
  running.value ? inputHint(running.value.input ?? running.value.detail) : "",
);
const title = computed(() => [step.value, hint.value].filter(Boolean).join(" "));
const now = useElapsedClock();
const elapsed = computed(() => {
  const tool = running.value;
  if (!active.value || !tool || tool.startedAt === undefined) return "";
  return formatElapsed(now.value - tool.startedAt);
});
</script>

<template>
  <details class="work" :open="open || undefined" @toggle="toggle">
    <UiDisclosureSummary variant="fit" class="work-summary">
      <UiSpinner v-if="live" />
      <IconAlert v-else-if="failed" class="work-icon error" aria-hidden="true" />
      <IconCheck v-else class="work-icon" aria-hidden="true" />
      <span class="work-title">Работа</span>
      <template v-if="!open && step">
        <span class="work-step u-truncate" :title="title"
          >{{ step }}<span v-if="hint" class="work-hint">{{ " " + hint }}</span></span
        >
        <span v-if="elapsed" class="work-time">{{ elapsed }}</span>
      </template>
      <IconChevron class="work-chevron" aria-hidden="true" />
    </UiDisclosureSummary>
    <div v-if="open" class="work-body">
      <template v-for="item in items" :key="item.key">
        <AgentThought
          v-if="item.type === 'thought'"
          :text="item.text"
          :streaming="thinking && item === items.at(-1)"
        />
        <AgentActivity v-else :tools="item.tools" :root="root" @open="emit('open', $event)" />
      </template>
    </div>
  </details>
</template>

<style scoped>
.work {
  margin: 0 0 var(--sp-3);
  max-width: 100%;
  color: var(--muted);
  font-size: var(--fs-2xs);
}
.work:last-child {
  margin-bottom: 0;
}
svg {
  width: 13px;
  height: 13px;
  flex-shrink: 0;
}
.work-icon {
  color: var(--faint);
}
.work-icon.error {
  color: var(--err);
}
.work-step {
  min-width: 0;
  color: var(--text-2);
}
.work-hint {
  color: var(--faint);
}
.work-time {
  flex-shrink: 0;
  color: var(--faint);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.work-chevron {
  width: 12px;
  transition: transform var(--t-fast);
}
.work[open] > summary .work-chevron {
  transform: rotate(90deg);
}
.work-body {
  max-height: min(60vh, 520px);
  margin-top: var(--sp-1);
  padding-left: var(--sp-3);
  border-left: 1px solid var(--line);
  overflow-y: auto;
  overscroll-behavior: contain;
}
@media (prefers-reduced-motion: reduce) {
  .work-chevron {
    transition: none;
  }
}
</style>
