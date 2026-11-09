<script setup lang="ts">
import { computed, ref } from "vue";
import UiSpinner from "../../../../../common/ui/UiSpinner.vue";
import type { AgentJobView } from "../../../../agent-core/index.ts";
import { jobBarSections } from "../lib/job-bar.ts";
import type { PlanItem } from "../../../../agent-core/index.ts";
import type {
  AgentBackendId,
  AgentSelection,
  AgentTask,
  QueuedMessage,
} from "../../../../agent-core/index.ts";
import AgentJobBar from "./AgentJobBar.vue";
import AgentPlan from "./AgentPlan.vue";
import AgentQueue from "./AgentQueue.vue";
import AgentTaskBar from "./AgentTaskBar.vue";
import IconAlert from "~icons/lucide/circle-alert";
import IconChevron from "~icons/lucide/chevron-right";
import IconListChecks from "~icons/lucide/list-checks";

/** One line for everything running in the background; the lists live behind it. */
const props = defineProps<{
  jobs: AgentJobView[];
  /** The key of this chat: only jobs it started stay in its finished list. */
  chat?: string;
  tasks: AgentTask[];
  plan: PlanItem[];
  queue: QueuedMessage[];
  busy: boolean;
  canInject?: boolean;
  viewingTask?: string;
  projectId?: string;
  backend?: AgentBackendId;
  selection?: AgentSelection;
}>();
const emit = defineEmits<{
  open: [id: string];
  view: [id: string];
  tab: [id: string];
  now: [id: string];
  inject: [id: string];
  remove: [id: string];
}>();

const expanded = ref(false);
const jobSections = computed(() => jobBarSections(props.jobs, props.chat));
const activeJobs = computed(() => jobSections.value.active);
const recentJobs = computed(() => jobSections.value.recent);
const runningTasks = computed(() => props.tasks.filter((task) => task.status === "running").length);
const failedTasks = computed(() => props.tasks.filter((task) => task.status === "error").length);
const planDone = computed(() => props.plan.filter((item) => item.status === "completed").length);
const planLeft = computed(() => props.plan.length - planDone.value);
const waiting = computed(
  () => activeJobs.value.filter((job) => job.status === "needs-user").length,
);
const has = computed(
  () =>
    activeJobs.value.length > 0 ||
    recentJobs.value.length > 0 ||
    props.tasks.length > 0 ||
    planLeft.value > 0 ||
    props.queue.length > 0,
);
const working = computed(() => activeJobs.value.length > 0 || runningTasks.value > 0);
const attention = computed(() => waiting.value > 0 || failedTasks.value > 0);

const summary = computed(() => {
  const parts: string[] = [];
  if (activeJobs.value.length)
    parts.push(
      `задания: ${activeJobs.value.length}${waiting.value ? ` · ждёт ответа: ${waiting.value}` : ""}`,
    );
  if (recentJobs.value.length) parts.push(`завершено: ${recentJobs.value.length}`);
  if (props.tasks.length)
    parts.push(
      `задачи: ${props.tasks.length}${
        runningTasks.value
          ? ` · в работе: ${runningTasks.value}`
          : failedTasks.value
            ? ` · ошибки: ${failedTasks.value}`
            : ""
      }`,
    );
  if (planLeft.value) parts.push(`план: ${planDone.value}/${props.plan.length}`);
  if (props.queue.length) parts.push(`очередь: ${props.queue.length}`);
  return parts.join(" · ");
});
</script>

<template>
  <section v-if="has" class="activity" aria-label="Фоновая работа">
    <button type="button" class="summary" :aria-expanded="expanded" @click="expanded = !expanded">
      <UiSpinner v-if="working" />
      <IconAlert v-else-if="attention" class="alert" aria-hidden="true" />
      <IconListChecks v-else aria-hidden="true" />
      <span class="text" :title="summary">{{ summary }}</span>
      <IconChevron class="chevron" :class="{ expanded }" aria-hidden="true" />
    </button>
    <div v-if="expanded" class="body">
      <AgentJobBar
        :project-id="projectId"
        :active="activeJobs"
        :recent="recentJobs"
        @open="emit('open', $event)"
      />
      <AgentPlan :items="plan" :busy="busy" embedded />
      <AgentTaskBar
        :tasks="tasks"
        :viewing="viewingTask"
        :project-id="projectId"
        :backend="backend"
        :selection="selection"
        embedded
        @view="emit('view', $event)"
        @tab="emit('tab', $event)"
      />
      <AgentQueue
        :items="queue"
        :busy="busy"
        :can-inject="canInject"
        embedded
        @now="emit('now', $event)"
        @inject="emit('inject', $event)"
        @remove="emit('remove', $event)"
      />
    </div>
  </section>
</template>

<style scoped>
.activity {
  margin: 0;
}
.summary {
  display: flex;
  align-items: center;
  gap: 7px;
  width: 100%;
  min-width: 0;
  padding: 5px var(--sp-2);
  border: 0;
  border-radius: var(--r-md);
  background: none;
  color: var(--muted);
  font: inherit;
  font-size: var(--fs-2xs);
  text-align: left;
  cursor: pointer;
  transition:
    background var(--t-fast),
    color var(--t-fast);
}
.summary:hover,
.summary[aria-expanded="true"] {
  background: var(--hover);
  color: var(--text-2);
}
.summary svg {
  width: 13px;
  height: 13px;
  flex-shrink: 0;
}
.alert {
  color: var(--warn);
}
.text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
.chevron {
  width: 12px;
  margin-left: auto;
  transition: transform var(--t-fast);
}
.chevron.expanded {
  transform: rotate(90deg);
}
/* One scroll owner for the lists: rows inside it stay flat instead of becoming cards on cards. */
.body {
  display: grid;
  gap: var(--sp-2);
  margin-top: var(--sp-1);
  padding: var(--sp-2) var(--sp-2) var(--sp-1);
  border-top: 1px solid var(--line);
  max-height: min(32vh, 300px);
  overflow-y: auto;
  scrollbar-width: thin;
}
@media (prefers-reduced-motion: reduce) {
  .summary,
  .chevron {
    transition: none;
  }
}
</style>
