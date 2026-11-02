<script setup lang="ts">
import UiHeading from "../../../../../common/ui/UiHeading.vue";
import UiHint from "../../../../../common/ui/UiHint.vue";
import UiInline from "../../../../../common/ui/UiInline.vue";
import UiStatusDot from "../../../../../common/ui/UiStatusDot.vue";
import { computed } from "vue";
import type { PipelineJob } from "../../../../../../core/modules/workspace/index.ts";
import { relativeTime, shortHash } from "../../../../../common/utilities/commit-format.ts";
import { readoutLines, useTabReadout } from "../../../../../common/utilities/tab-readout.ts";
import {
  commandArgs,
  useCommandRegistrar,
  useCommandScope,
} from "../../../../../common/utilities/commands.ts";
import { usePipelineDetail } from "../lib/detail.ts";
import { durationLabel, PIPELINE_STATUS_LABEL, PIPELINE_STATUS_TONE } from "../lib/status.ts";
import IconExternal from "~icons/lucide/external-link";

/** Pipeline tab: status, ref and commit, then the jobs of the run grouped by stage. */
const props = withDefaults(defineProps<{ projectId: string; id: number; host?: string }>(), {
  host: "GitLab",
});
const emit = defineEmits<{ openJob: [job: { id: number; title: string }, pinned?: boolean] }>();
const { detail, loading, error, reload } = usePipelineDetail(
  () => props.projectId,
  () => props.id,
);
const groups = computed(() => {
  const stages = new Map<string, PipelineJob[]>();
  for (const job of detail.value?.jobs ?? []) {
    const stage = job.stage || "без стадии";
    const rows = stages.get(stage) ?? [];
    rows.push(job);
    stages.set(stage, rows);
  }
  return [...stages.entries()].map(([stage, jobs]) => ({ stage, jobs }));
});
const commands = useCommandScope(`pipeline:${props.projectId}:${props.id}`, () => ({
  surface: "pipeline",
  projectId: props.projectId,
  pipelineId: props.id,
}));
const register = useCommandRegistrar(commands.scope);
const openJob = (job: { id: number; name: string }, pinned = false) =>
  commands.run("ide.pipeline.job.open", { id: job.id, title: job.name, pinned });
register(
  "ide.pipeline.refresh",
  "Обновить pipeline",
  "Перечитывает статус pipeline и список его джобов.",
  () => reload(),
);
register(
  "ide.pipeline.job.open",
  "Открыть джоб",
  "Открывает вкладку джоба: статус, стадия и readonly-лог.",
  (value) => {
    const { id, title, pinned } = commandArgs(value);
    if (typeof id !== "number") throw new Error("Укажите номер джоба");
    emit("openJob", { id, title: typeof title === "string" ? title : "" }, pinned === true);
  },
  {
    id: "number: номер джоба",
    title: "string (необязательно): заголовок вкладки",
    pinned: "boolean (необязательно): true — постоянная вкладка",
  },
);

useTabReadout(() => {
  const note = `Pipeline #${props.id}`;
  if (error.value) return { note, text: `Ошибка: ${error.value}` };
  const data = detail.value;
  if (!data) return { note, text: "Загрузка…" };
  const pipeline = data.pipeline;
  const jobs = data.jobs.map(
    (job) =>
      `${PIPELINE_STATUS_LABEL[job.status]}: ${job.stage ? `${job.stage} / ` : ""}${job.name} (#${job.id})`,
  );
  const shown = jobs.slice(0, 100);
  return {
    note,
    text: readoutLines(
      `Состояние: ${PIPELINE_STATUS_LABEL[pipeline.status]}`,
      `Ветка: ${pipeline.ref || "нет"}, коммит: ${pipeline.sha || "нет"}`,
      `Источник: ${pipeline.source || "нет"}`,
      `Создан: ${pipeline.createdAt}`,
      pipeline.duration !== null ? `Длительность: ${durationLabel(pipeline.duration)}` : "",
      `Джобов: ${data.jobs.length}`,
      shown.length ? `Джобы:\n${shown.join("\n")}` : "Джобов нет",
      data.jobsTruncated
        ? `Показано ${data.jobs.length} джобов, остальные — на ${props.host}.`
        : "",
    ),
  };
});
</script>

<template>
  <div class="pipeline-view">
    <UiHint v-if="loading" size="xs" leading="inherit" class="note" role="status"
      >загрузка: pipeline…</UiHint
    >
    <UiHint v-else-if="error" size="xs" leading="inherit" class="note error" role="alert">{{
      error
    }}</UiHint>
    <article v-else-if="detail" class="article">
      <UiInline as="header" class="head" align="baseline" wrap justify="normal">
        <span class="state" :class="detail.pipeline.status">{{
          PIPELINE_STATUS_LABEL[detail.pipeline.status]
        }}</span>
        <UiHeading as="h2" size="lg" weight="semibold" :space-after="0">
          {{ detail.pipeline.name || "Pipeline" }}
          <span class="number">#{{ detail.pipeline.id }}</span>
        </UiHeading>
      </UiInline>
      <UiInline as="p" class="meta" wrap>
        <span v-if="detail.pipeline.ref" class="mono">{{ detail.pipeline.ref }}</span>
        <span v-if="detail.pipeline.sha" class="mono">{{ shortHash(detail.pipeline.sha) }}</span>
        <span v-if="detail.pipeline.source">{{ detail.pipeline.source }}</span>
        <span v-if="detail.pipeline.createdAt" :title="detail.pipeline.createdAt"
          >создан {{ relativeTime(detail.pipeline.createdAt) }}</span
        >
        <span v-if="durationLabel(detail.pipeline.duration)"
          >за {{ durationLabel(detail.pipeline.duration) }}</span
        >
        <UiInline
          as="a"
          inline
          :gap="1"
          justify="normal"
          v-if="detail.pipeline.webUrl"
          class="external"
          :href="detail.pipeline.webUrl"
          target="_blank"
          rel="noopener noreferrer"
        >
          <IconExternal aria-hidden="true" />на {{ host }}
        </UiInline>
      </UiInline>

      <UiHeading as="h3" size="sm" tone="secondary" :space-before="4" :space-after="2"
        >Джобы</UiHeading
      >
      <UiHint v-if="!detail.jobs.length" size="xs" leading="inherit" class="note"
        >Джобов нет</UiHint
      >
      <div v-for="group in groups" :key="group.stage" class="stage">
        <h4>{{ group.stage }}</h4>
        <ul class="job-list">
          <li v-for="job in group.jobs" :key="job.id">
            <button
              type="button"
              class="job"
              :title="job.failureReason || `Открыть джоб #${job.id}`"
              @click="openJob(job)"
            >
              <UiStatusDot :tone="PIPELINE_STATUS_TONE[job.status]" shrink />
              <span class="job-name">{{ job.name || `Job #${job.id}` }}</span>
              <span class="job-status">{{ PIPELINE_STATUS_LABEL[job.status] }}</span>
              <span v-if="durationLabel(job.duration)" class="job-time">{{
                durationLabel(job.duration)
              }}</span>
              <span class="job-number">#{{ job.id }}</span>
            </button>
          </li>
        </ul>
      </div>
      <UiHint
        v-if="detail.jobsTruncated"
        size="xs"
        leading="inherit"
        :space-before="2"
        class="note"
      >
        Показано {{ detail.jobs.length }} джобов. Остальные — на {{ host }}.
      </UiHint>
    </article>
  </div>
</template>

<style scoped>
.pipeline-view {
  height: 100%;
  overflow: auto;
  padding: var(--sp-4);
}
.article {
  max-width: 880px;
  margin: 0 auto;
}
.state {
  padding: 1px var(--sp-2);
  border-radius: var(--r-full);
  background: var(--active);
  color: var(--muted);
  font-size: var(--fs-2xs);
}
.state.running,
.state.manual {
  background: color-mix(in srgb, var(--warn) 22%, transparent);
  color: var(--warn);
}
.state.success {
  background: color-mix(in srgb, var(--run) 22%, transparent);
  color: var(--run);
}
.state.failed {
  background: color-mix(in srgb, var(--err) 22%, transparent);
  color: var(--err);
}
.number,
.mono {
  color: var(--muted);
  font-family: var(--mono);
  font-size: var(--fs-xs);
}
.meta {
  margin: var(--sp-2) 0 0;
  color: var(--muted);
  font-size: var(--fs-xs);
}
.external {
  color: var(--text-2);
}
.external svg {
  width: 13px;
  height: 13px;
}
.stage + .stage {
  margin-top: var(--sp-3);
}
.stage h4 {
  margin: 0 0 var(--sp-1);
  color: var(--faint);
  font-size: var(--fs-2xs);
  font-weight: 500;
}
.job-list {
  list-style: none;
  margin: 0;
  padding: 0;
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  overflow: hidden;
}
.job-list li + li {
  border-top: 1px solid var(--line);
}
.job {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  width: 100%;
  padding: var(--sp-2) var(--sp-3);
  text-align: left;
  color: var(--text-2);
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
.job-status,
.job-time,
.job-number {
  color: var(--muted);
  font-size: var(--fs-2xs);
}
.job-time,
.job-number {
  font-family: var(--mono);
}
.note.error {
  color: var(--err);
}
</style>
