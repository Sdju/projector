<script setup lang="ts">
import UiHeading from "../../../../../common/ui/UiHeading.vue";
import UiHint from "../../../../../common/ui/UiHint.vue";
import UiInline from "../../../../../common/ui/UiInline.vue";
import UiStatusDot from "../../../../../common/ui/UiStatusDot.vue";
import { computed, ref } from "vue";
import type {
  PipelineJob,
  PipelineStatus,
} from "../../../../../../core/modules/workspace/index.ts";
import { countRu } from "../../../../../common/utilities/plural.ts";
import { relativeTime, shortHash } from "../../../../../common/utilities/commit-format.ts";
import { readoutLines, useTabReadout } from "../../../../../common/utilities/tab-readout.ts";
import {
  commandArgs,
  useCommandRegistrar,
  useCommandScope,
} from "../../../../../common/utilities/commands.ts";
import { usePipelineDetail } from "../lib/detail.ts";
import {
  durationLabel,
  PIPELINE_STATUS_LABEL,
  PIPELINE_STATUS_TONE,
  refLabel,
  sourceLabel,
} from "../../../../../../core/modules/workspace/index.ts";
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
const problemsOnly = ref(false);
const PROBLEM_STATUSES = new Set<PipelineStatus>(["failed", "canceled"]);
const groups = computed(() => {
  const stages = new Map<string, PipelineJob[]>();
  for (const job of detail.value?.jobs ?? []) {
    if (problemsOnly.value && !PROBLEM_STATUSES.has(job.status)) continue;
    const stage = job.stage || "без стадии";
    const rows = stages.get(stage) ?? [];
    rows.push(job);
    stages.set(stage, rows);
  }
  return [...stages.entries()].map(([stage, jobs]) => ({
    stage,
    jobs,
    count: countRu(jobs.length, "джоб", "джоба", "джобов"),
    summary: stageSummary(jobs),
    tone: stageTone(jobs),
  }));
});
const failing = computed(
  () => (detail.value?.jobs ?? []).filter((job) => PROBLEM_STATUSES.has(job.status)).length,
);
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

/** Statuses of one stage in a short form: `10 успешно · 2 ошибки · 1 идёт`. */
function stageSummary(jobs: PipelineJob[]) {
  const counts = new Map<PipelineStatus, number>();
  for (const job of jobs) counts.set(job.status, (counts.get(job.status) ?? 0) + 1);
  const order: PipelineStatus[] = [
    "failed",
    "canceled",
    "running",
    "queued",
    "manual",
    "success",
    "skipped",
    "unknown",
  ];
  return order.flatMap((status) => {
    const count = counts.get(status);
    return count ? [`${count} ${PIPELINE_STATUS_LABEL[status]}`] : [];
  });
}
function stageTone(jobs: PipelineJob[]) {
  if (jobs.some((job) => PROBLEM_STATUSES.has(job.status))) return "danger" as const;
  if (jobs.some((job) => job.status === "running")) return "warning" as const;
  if (jobs.every((job) => job.status === "success")) return "success" as const;
  return "muted" as const;
}

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
      `Ветка: ${refLabel(pipeline.ref) || "нет"}, коммит: ${pipeline.sha || "нет"}`,
      `Источник: ${sourceLabel(pipeline.source) || "нет"}`,
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
          Pipeline <span class="number">#{{ detail.pipeline.id }}</span>
        </UiHeading>
      </UiInline>
      <p v-if="detail.pipeline.name" class="workflow" :title="detail.pipeline.name">
        {{ detail.pipeline.name }}
      </p>
      <UiInline as="p" class="meta" wrap>
        <span v-if="detail.pipeline.ref" class="mono">{{ refLabel(detail.pipeline.ref) }}</span>
        <span v-if="detail.pipeline.source">{{ sourceLabel(detail.pipeline.source) }}</span>
        <span v-if="detail.pipeline.sha" class="mono">{{ shortHash(detail.pipeline.sha) }}</span>
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

      <div class="jobs-head">
        <UiHeading as="h3" size="sm" tone="secondary" :space-before="4" :space-after="0"
          >Джобы</UiHeading
        >
        <span class="jobs-count">{{ countRu(detail.jobs.length, "джоб", "джоба", "джобов") }}</span>
        <div v-if="failing" class="job-filter" role="group" aria-label="Фильтр джобов">
          <button
            type="button"
            :class="{ active: !problemsOnly }"
            :aria-pressed="!problemsOnly"
            @click="problemsOnly = false"
          >
            все
          </button>
          <button
            type="button"
            :class="{ active: problemsOnly }"
            :aria-pressed="problemsOnly"
            @click="problemsOnly = true"
          >
            проблемы ({{ failing }})
          </button>
        </div>
      </div>
      <UiHint v-if="!detail.jobs.length" size="xs" leading="inherit" class="note"
        >Джобов нет</UiHint
      >
      <UiHint v-else-if="!groups.length" size="xs" leading="inherit" class="note"
        >Проблемных джобов нет</UiHint
      >
      <div v-for="group in groups" :key="group.stage" class="stage">
        <details
          :open="
            group.jobs.length <= 20 || group.jobs.some((job) => PROBLEM_STATUSES.has(job.status))
          "
        >
          <summary>
            <UiStatusDot :tone="group.tone" shrink />
            <span class="stage-name">{{ group.stage }}</span>
            <span class="stage-count">{{ group.count }}</span>
            <span class="stage-summary">{{ group.summary.join(" · ") }}</span>
          </summary>
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
        </details>
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
.workflow {
  margin: var(--sp-1) 0 0;
  color: var(--muted);
  font: var(--fs-2xs) var(--mono);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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
.jobs-head {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: var(--sp-2);
  margin-top: var(--sp-3);
}
.jobs-count {
  color: var(--faint);
  font-size: var(--fs-2xs);
}
.job-filter {
  display: flex;
  gap: var(--sp-1);
  margin-left: auto;
}
.job-filter button {
  padding: 1px var(--sp-2);
  border: 1px solid var(--line);
  border-radius: var(--r-sm);
  color: var(--muted);
  font-size: var(--fs-2xs);
}
.job-filter button:hover {
  color: var(--text);
}
.job-filter button.active {
  border-color: var(--focus);
  background: var(--active);
  color: var(--text);
}
.stage + .stage {
  margin-top: var(--sp-2);
}
.stage details > summary {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  padding: var(--sp-1) 0;
  color: var(--faint);
  font-size: var(--fs-2xs);
  cursor: pointer;
  user-select: none;
}
.stage details > summary::before {
  content: "▸";
  color: var(--faint);
  font-size: var(--fs-2xs);
  transition: transform var(--t-fast);
}
.stage details[open] > summary::before {
  transform: rotate(90deg);
}
.stage-name {
  color: var(--text-2);
  font-weight: 500;
}
.stage-count {
  color: var(--muted);
  font-family: var(--mono);
}
.stage-summary {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.job-list {
  list-style: none;
  margin: var(--sp-1) 0 0;
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
