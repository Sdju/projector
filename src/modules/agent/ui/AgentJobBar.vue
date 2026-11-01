<script setup lang="ts">
import { computed } from "vue";
import type { AgentJobView } from "../api/jobs.ts";
import { agentLabel } from "../model/modes.ts";
import IconSpinner from "~icons/lucide/loader-circle";
import IconShield from "~icons/lucide/shield-question";

/** What runs in the background of this project, above the composer of the Projector chat. */
const props = defineProps<{ jobs: AgentJobView[] }>();
const emit = defineEmits<{ open: [id: string] }>();

const shown = computed(() =>
  props.jobs.filter(
    (job) => job.status === "running" || job.status === "queued" || job.status === "needs-user",
  ),
);
const state = (job: AgentJobView) =>
  job.status === "needs-user" ? "ждёт ответа" : job.status === "queued" ? "в очереди" : "работает";
</script>

<template>
  <div v-if="shown.length" class="jobs" aria-label="Фоновые задания">
    <button
      v-for="job in shown"
      :key="job.id"
      type="button"
      class="job"
      :class="job.status"
      @click="emit('open', job.id)"
    >
      <IconShield v-if="job.status === 'needs-user'" class="mark" aria-hidden="true" />
      <IconSpinner v-else class="mark spin" aria-hidden="true" />
      <span class="agent">{{ agentLabel(job.backend) }}</span>
      <span class="task" :title="job.task">{{ job.task }}</span>
      <span class="state">{{ state(job) }}</span>
    </button>
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
  color: var(--muted);
}
.needs-user .mark {
  color: var(--warn);
}
.spin {
  animation: spin 1.6s linear infinite;
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
.state {
  flex-shrink: 0;
  margin-left: auto;
  font-size: 12px;
  color: var(--muted);
}
.needs-user .state {
  color: var(--warn);
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
