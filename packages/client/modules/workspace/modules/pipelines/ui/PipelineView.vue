<script setup lang="ts">
import UiArticle from "../../../../../common/ui/UiArticle.vue";
import UiDetailHeader from "../../../../../common/ui/UiDetailHeader.vue";
import UiHeading from "../../../../../common/ui/UiHeading.vue";
import UiHint from "../../../../../common/ui/UiHint.vue";
import UiViewerPage from "../../../../../common/ui/UiViewerPage.vue";
import UiStatusDot from "../../../../../common/ui/UiStatusDot.vue";
import { computed, ref } from "vue";
import { countRu } from "../../../../../common/utilities/plural.ts";
import { groupPipelineStages, PIPELINE_PROBLEM_STATUSES } from "../../../../workspace-api/index.ts";
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
} from "@projector/core/modules/workspace/index.ts";
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
const groups = computed(() =>
  groupPipelineStages(detail.value?.jobs ?? [], { problemsOnly: problemsOnly.value }),
);
const failing = computed(
  () =>
    (detail.value?.jobs ?? []).filter((job) => PIPELINE_PROBLEM_STATUSES.has(job.status)).length,
);
const stateTone = computed(() => {
  const tone = detail.value ? PIPELINE_STATUS_TONE[detail.value.pipeline.status] : "muted";
  return tone === "warning" || tone === "success" || tone === "danger" ? tone : "neutral";
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
  <UiViewerPage>
    <UiHint v-if="loading" size="xs" leading="inherit" class="note" role="status"
      >загрузка: pipeline…</UiHint
    >
    <UiHint v-else-if="error" size="xs" leading="inherit" class="note error" role="alert">{{
      error
    }}</UiHint>
    <UiArticle v-else-if="detail">
      <UiDetailHeader
        :state="PIPELINE_STATUS_LABEL[detail.pipeline.status]"
        :tone="stateTone"
        title="Pipeline"
        :number="detail.pipeline.id"
        :subtitle="detail.pipeline.name"
        :external-href="detail.pipeline.webUrl"
        :host="host"
      >
        <template #meta>
          <span v-if="detail.pipeline.ref" class="mono">{{ refLabel(detail.pipeline.ref) }}</span>
          <span v-if="detail.pipeline.source">{{ sourceLabel(detail.pipeline.source) }}</span>
          <span v-if="detail.pipeline.sha" class="mono">{{ shortHash(detail.pipeline.sha) }}</span>
          <span v-if="detail.pipeline.createdAt" :title="detail.pipeline.createdAt"
            >создан {{ relativeTime(detail.pipeline.createdAt) }}</span
          >
          <span v-if="durationLabel(detail.pipeline.duration)"
            >за {{ durationLabel(detail.pipeline.duration) }}</span
          >
        </template>
      </UiDetailHeader>

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
            group.jobs.length <= 20 ||
            group.jobs.some((job) => PIPELINE_PROBLEM_STATUSES.has(job.status))
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
    </UiArticle>
  </UiViewerPage>
</template>

<style scoped>
.mono {
  color: var(--muted);
  font-family: var(--mono);
  font-size: var(--fs-xs);
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
