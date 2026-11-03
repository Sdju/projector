<script setup lang="ts">
import UiHint from "../../../../../common/ui/UiHint.vue";
import UiStatusDot from "../../../../../common/ui/UiStatusDot.vue";
import { computed } from "vue";
import type { PipelineJob, PipelineStatus } from "@projector/core/modules/workspace/index.ts";
import {
  durationLabel,
  PIPELINE_STATUS_LABEL,
  PIPELINE_STATUS_TONE,
} from "@projector/core/modules/workspace/index.ts";
import { usePullPipeline } from "../lib/pull-pipeline.ts";

/** Ход pipeline по стадиям внутри карточки merge request; обновляется, пока стадии раскрыты. */
const props = defineProps<{ projectId: string; id: number; host: string }>();
const emit = defineEmits<{ openJob: [job: { id: number; title: string }] }>();
const { detail, error } = usePullPipeline(
  () => props.projectId,
  () => props.id,
);
const PROBLEM = new Set<PipelineStatus>(["failed", "canceled"]);
const ORDER: PipelineStatus[] = [
  "failed",
  "canceled",
  "running",
  "queued",
  "manual",
  "success",
  "skipped",
  "unknown",
];
const groups = computed(() => {
  const stages = new Map<string, { jobs: PipelineJob[]; first: number }>();
  for (const job of detail.value?.jobs ?? []) {
    const stage = job.stage || "без стадии";
    const entry = stages.get(stage) ?? { jobs: [], first: job.id };
    entry.jobs.push(job);
    entry.first = Math.min(entry.first, job.id);
    stages.set(stage, entry);
  }
  // GitLab allocates job ids in reverse stage order, so the earliest id is the stage order.
  return [...stages.entries()]
    .sort(([, left], [, right]) => left.first - right.first)
    .map(([stage, { jobs }]) => {
      const counts = new Map<PipelineStatus, number>();
      for (const job of jobs) counts.set(job.status, (counts.get(job.status) ?? 0) + 1);
      const problems = jobs.filter((job) => PROBLEM.has(job.status));
      const running = jobs.filter((job) => job.status === "running");
      const visible = problems.length ? problems.slice(0, 5) : running.slice(0, 1);
      return {
        stage,
        jobs,
        total: jobs.length,
        done: jobs.filter((job) => !["queued", "running", "manual"].includes(job.status)).length,
        problems,
        running,
        visible,
        hidden: problems.length + running.length - visible.length,
        summary: ORDER.flatMap((status) => {
          const count = counts.get(status);
          return count ? [`${count} ${PIPELINE_STATUS_LABEL[status]}`] : [];
        }),
        tone: problems.length
          ? ("danger" as const)
          : running.length
            ? ("warning" as const)
            : jobs.every((job) => job.status === "success")
              ? ("success" as const)
              : ("muted" as const),
      };
    });
});
</script>

<template>
  <div class="stages">
    <UiHint v-if="!detail && !error" size="xs" leading="inherit" class="note" role="status"
      >загрузка: стадии…</UiHint
    >
    <UiHint v-else-if="error" size="xs" leading="inherit" class="note error" role="alert">{{
      error
    }}</UiHint>
    <UiHint v-else-if="!groups.length" size="xs" leading="inherit" class="note">Джобов нет</UiHint>
    <div v-for="group in groups" :key="group.stage" class="stage">
      <div class="stage-head">
        <UiStatusDot :tone="group.tone" shrink />
        <span class="stage-name">{{ group.stage }}</span>
        <span class="stage-count">{{ group.done }}/{{ group.total }}</span>
        <span class="stage-summary">{{ group.summary.join(" · ") }}</span>
      </div>
      <div v-if="group.visible.length" class="jobs">
        <button
          v-for="job in group.visible"
          :key="job.id"
          type="button"
          class="job"
          :title="job.failureReason || `Открыть джоб #${job.id}`"
          @click="emit('openJob', { id: job.id, title: job.name })"
        >
          <UiStatusDot :tone="PIPELINE_STATUS_TONE[job.status]" shrink />
          <span class="job-name">{{ job.name || `Job #${job.id}` }}</span>
          <span v-if="durationLabel(job.duration)" class="job-time">{{
            durationLabel(job.duration)
          }}</span>
          <span class="job-number">#{{ job.id }}</span>
        </button>
        <span v-if="group.hidden" class="more">ещё {{ group.hidden }} · откройте pipeline</span>
      </div>
    </div>
    <UiHint v-if="detail?.jobsTruncated" size="xs" leading="inherit" class="note">
      Показаны не все джобы — остальные на {{ host }}.
    </UiHint>
  </div>
</template>

<style scoped>
.stages {
  padding: 0 var(--sp-3) var(--sp-2);
}
.stage + .stage {
  margin-top: var(--sp-1);
}
.stage-head {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  padding: var(--sp-1) 0;
  color: var(--muted);
  font-size: var(--fs-2xs);
}
.stage-name {
  color: var(--text-2);
  font-weight: 500;
}
.stage-count {
  font-family: var(--mono);
}
.stage-summary {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--faint);
}
.jobs {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding-left: var(--sp-4);
}
.job {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  padding: 2px var(--sp-2);
  border-radius: var(--r-sm);
  text-align: left;
  color: var(--text-2);
  font-size: var(--fs-2xs);
}
.job:hover {
  background: var(--active);
  color: var(--text);
}
.job-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.job-time,
.job-number {
  color: var(--muted);
  font-family: var(--mono);
}
.more {
  padding: 1px var(--sp-2);
  color: var(--faint);
  font-size: var(--fs-2xs);
}
.note {
  margin: var(--sp-1) 0 0;
}
.note.error {
  color: var(--err);
}
</style>
