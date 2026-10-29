<script setup lang="ts">
import { computed, ref } from "vue";
import UiDisclosureSummary from "../../../common/ui/UiDisclosureSummary.vue";
import UiSpinner from "../../../common/ui/UiSpinner.vue";
import type { AgentTask } from "../model/types.ts";
import AgentTaskRow from "./AgentTaskRow.vue";
import IconAlert from "~icons/lucide/circle-alert";
import IconCheck from "~icons/lucide/check";
import IconChevron from "~icons/lucide/chevron-right";

/** Subagents and background commands as a strip above the input: open one to read, or in a tab. */
const props = defineProps<{ tasks: AgentTask[]; viewing?: string }>();
const emit = defineEmits<{ view: [id: string]; tab: [id: string] }>();

// What needs attention stays in sight; the finished ones fold into their own group.
const active = computed(() =>
  props.tasks.filter((task) => task.status === "running" || task.status === "error"),
);
const finished = computed(() => props.tasks.filter((task) => !active.value.includes(task)));
const running = computed(() => props.tasks.filter((task) => task.status === "running").length);
const failed = computed(() => props.tasks.filter((task) => task.status === "error").length);
const title = computed(() => {
  const parts = [
    running.value ? `Выполняется в фоне: ${running.value}` : `Задачи: ${props.tasks.length}`,
    failed.value ? `ошибок: ${failed.value}` : "",
    running.value && finished.value.length ? `готово: ${finished.value.length}` : "",
  ];
  return parts.filter(Boolean).join(" · ");
});
// Opened while something runs, until the user folds it by hand.
const folded = ref<boolean>();
const open = computed(() => (folded.value === undefined ? running.value > 0 : !folded.value));
// With nothing to watch, the finished ones are the list itself.
const showFinished = computed(() => !active.value.length);
</script>

<template>
  <details
    v-if="tasks.length"
    class="task-bar"
    :open="open"
    @toggle="folded = !($event.target as HTMLDetailsElement).open"
  >
    <UiDisclosureSummary variant="fit" class="bar-summary">
      <UiSpinner v-if="running" />
      <IconAlert v-else-if="failed" class="error-icon" aria-label="Есть ошибки" />
      <IconCheck v-else class="done-icon" aria-hidden="true" />
      <span>{{ title }}</span>
      <IconChevron class="chevron" aria-hidden="true" />
    </UiDisclosureSummary>
    <div class="scroll">
      <ul v-if="active.length" class="list">
        <AgentTaskRow
          v-for="task in active"
          :key="task.id"
          :task="task"
          :current="viewing === task.id"
          @view="emit('view', $event)"
          @tab="emit('tab', $event)"
        />
      </ul>
      <details v-if="finished.length" class="finished" :open="showFinished || undefined">
        <UiDisclosureSummary variant="fit" class="finished-summary">
          <span>Завершено: {{ finished.length }}</span>
          <IconChevron class="chevron" aria-hidden="true" />
        </UiDisclosureSummary>
        <ul class="list">
          <AgentTaskRow
            v-for="task in finished"
            :key="task.id"
            :task="task"
            :current="viewing === task.id"
            @view="emit('view', $event)"
            @tab="emit('tab', $event)"
          />
        </ul>
      </details>
    </div>
  </details>
</template>

<style scoped>
.task-bar {
  margin: 0 0 var(--sp-2);
  padding: var(--sp-1) var(--sp-2);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--panel);
  color: var(--muted);
  font-size: var(--fs-2xs);
}
svg {
  width: 13px;
  height: 13px;
  flex-shrink: 0;
}
.chevron {
  width: 12px;
  transition: transform var(--t-fast);
}
.task-bar[open] > summary .chevron,
.finished[open] > summary .chevron {
  transform: rotate(90deg);
}
/* Dozens of tasks must not push the conversation out of the window. */
.scroll {
  max-height: min(40vh, 320px);
  margin-top: var(--sp-1);
  overflow-y: auto;
}
.list {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 2px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.finished {
  margin-top: var(--sp-1);
}
.finished-summary {
  padding: 2px var(--sp-1);
}
.finished > .list {
  margin-top: var(--sp-1);
}
.error-icon {
  color: var(--err);
}
.done-icon {
  color: var(--run);
}
@media (prefers-reduced-motion: reduce) {
  .chevron {
    transition: none;
  }
}
</style>
