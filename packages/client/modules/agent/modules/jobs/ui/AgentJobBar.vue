<script setup lang="ts">
import { computed } from "vue";
import UiDisclosureSummary from "../../../../../common/ui/UiDisclosureSummary.vue";
import type { AgentJobView } from "../../../../agent-core/index.ts";
import { jobDuration, jobStatusLabel } from "../lib/job-labels.ts";
import { jobShortTitle } from "../lib/job-name.ts";
import { useJobTitles } from "../model/job-titles.ts";
import { useElapsedClock } from "../../../../agent-core/index.ts";
import { agentLabel } from "../../../../agent-core/index.ts";
import { AgentStatusIcon } from "../../../../agent-turns/index.ts";
import IconChevron from "~icons/lucide/chevron-right";

/** Background jobs above the composer: what runs now, and what this chat just finished. */
const props = defineProps<{ projectId?: string; active: AgentJobView[]; recent: AgentJobView[] }>();
const emit = defineEmits<{ open: [id: string] }>();

const now = useElapsedClock();
const names = useJobTitles(
  () => props.projectId ?? "",
  () => [...props.active, ...props.recent],
);
const shown = computed(() => props.active.length > 0 || props.recent.length > 0);
const title = (job: AgentJobView) => names.value.get(job.id) ?? jobShortTitle(job.task);
const state = (job: AgentJobView) =>
  job.status === "needs-user" ? "ждёт ответа" : job.status === "queued" ? "в очереди" : "работает";
const meta = (job: AgentJobView) =>
  [
    jobDuration(job.startedAt ?? job.createdAt, job.endedAt, now.value),
    job.files.length ? `файлов: ${job.files.length}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
// A finished job keeps its outcome visible: an error or a stop is not just a check mark.
const outcome = (job: AgentJobView) =>
  job.status === "error" || job.status === "stopped" ? jobStatusLabel[job.status] : "";
</script>

<template>
  <div v-if="shown" class="jobs" aria-label="Фоновые задания">
    <button
      v-for="job in active"
      :key="job.id"
      type="button"
      class="job"
      :class="job.status"
      @click="emit('open', job.id)"
    >
      <AgentStatusIcon :status="job.status" class="mark" />
      <span class="agent">{{ agentLabel(job.backend) }}</span>
      <span class="task" :title="job.task">{{ title(job) }}</span>
      <span class="end">
        <span class="meta">{{ meta(job) }}</span>
        <span class="state">{{ state(job) }}</span>
      </span>
    </button>
    <details v-if="recent.length" class="finished">
      <UiDisclosureSummary variant="fit" class="finished-summary">
        <span>Завершено: {{ recent.length }}</span>
        <IconChevron class="chevron" aria-hidden="true" />
      </UiDisclosureSummary>
      <div class="list">
        <button
          v-for="job in recent"
          :key="job.id"
          type="button"
          class="job finished-row"
          :class="job.status"
          @click="emit('open', job.id)"
        >
          <AgentStatusIcon :status="job.status" class="mark" />
          <span class="agent">{{ agentLabel(job.backend) }}</span>
          <span class="task" :title="job.task">{{ title(job) }}</span>
          <span class="end">
            <span class="meta">{{ meta(job) }}</span>
            <span v-if="outcome(job)" class="state">{{ outcome(job) }}</span>
          </span>
        </button>
      </div>
    </details>
  </div>
</template>

<style scoped>
.jobs {
  display: grid;
  gap: 2px;
  margin: 0;
}
.job {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-width: 0;
  padding: 4px 6px;
  border: 0;
  border-radius: var(--r-md);
  background: none;
  color: var(--text);
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.job:hover {
  background: var(--hover);
}
.job.needs-user {
  background: color-mix(in srgb, var(--warn) 8%, transparent);
}
.mark {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
}
.agent {
  flex-shrink: 0;
  font-size: 12px;
  color: var(--muted);
}
.task {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.end {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  gap: 8px;
  margin-left: auto;
}
.meta,
.state {
  flex-shrink: 0;
  color: var(--muted);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
.needs-user .state {
  color: var(--warn);
}
.finished {
  margin-top: var(--sp-1);
}
.finished-summary {
  padding: 2px 6px;
  color: var(--muted);
  font-size: var(--fs-2xs);
}
.chevron {
  width: 12px;
  height: 12px;
  transition: transform var(--t-fast);
}
.finished[open] > .finished-summary .chevron {
  transform: rotate(90deg);
}
.list {
  display: grid;
  gap: 2px;
  margin-top: var(--sp-1);
}
@media (prefers-reduced-motion: reduce) {
  .chevron {
    transition: none;
  }
}
</style>
