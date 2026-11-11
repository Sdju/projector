<script setup lang="ts">
import UiArticle from "../../../../../common/ui/UiArticle.vue";
import UiDetailHeader from "../../../../../common/ui/UiDetailHeader.vue";
import UiHeading from "../../../../../common/ui/UiHeading.vue";
import UiHint from "../../../../../common/ui/UiHint.vue";
import UiLoader from "../../../../../common/ui/UiLoader.vue";
import UiViewerPage from "../../../../../common/ui/UiViewerPage.vue";
import UiStatusDot from "../../../../../common/ui/UiStatusDot.vue";
import { computed, ref } from "vue";
import { countRu } from "../../../../../common/utilities/plural.ts";
import {
  groupPipelineStages,
  PIPELINE_PROBLEM_STATUSES,
  tabRecordId,
} from "../../../../workspace-api/index.ts";
import { relativeTime, shortHash } from "../../../../../common/utilities/commit-format.ts";
import { readoutLines, useTabReadout } from "../../../../../common/utilities/tab-readout.ts";
import {
  commandArgs,
  useCommandRegistrar,
  useCommandScope,
} from "../../../../../common/utilities/commands.ts";
import { usePipelineDetail } from "../lib/detail.ts";
import PipelineAnnotations from "./PipelineAnnotations.vue";
import {
  durationLabel,
  PIPELINE_STATUS_LABEL,
  PIPELINE_STATUS_TONE,
  refLabel,
  sourceLabel,
} from "@ai-projector/core/modules/workspace/index.ts";
/** Pipeline tab: status, ref and commit, then the jobs of the run grouped by stage. */
const props = withDefaults(
  defineProps<{
    projectId: string;
    id?: number | string;
    number?: number | string;
    host?: string;
  }>(),
  { host: "GitLab" },
);
const emit = defineEmits<{
  openJob: [job: { id: number; title: string }, pinned?: boolean];
  openFile: [file: { path: string; line?: number }];
  openPull: [pull: { number: number }];
}>();
const recordId = () => tabRecordId({ id: props.id, number: props.number }, "id", "number") ?? 0;
const { detail, loading, error, reload } = usePipelineDetail(() => props.projectId, recordId);
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
const heading = computed(() => {
  const pipeline = detail.value?.pipeline;
  if (!pipeline) return "Pipeline";
  return pipeline.title || pipeline.name || "Pipeline";
});
const subtitle = computed(() => {
  const pipeline = detail.value?.pipeline;
  if (!pipeline?.title) return "";
  return pipeline.name;
});
const usageLabel = (milliseconds: number) => durationLabel(Math.round(milliseconds / 1000));
const commands = useCommandScope(`pipeline:${props.projectId}:${recordId()}`, () => ({
  surface: "pipeline",
  projectId: props.projectId,
  pipelineId: recordId(),
}));
const register = useCommandRegistrar(commands.scope);
const openJob = (job: { id: number; name: string }, pinned = false) =>
  commands.run("ide.pipeline.job.open", { id: job.id, title: job.name, pinned });
const openFile = (file: { path: string; line?: number }) =>
  commands.run("ide.pipeline.file.open", file);
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
register(
  "ide.pipeline.file.open",
  "Открыть файл pipeline",
  "Открывает файл workflow или путь из аннотации в вкладке редактора.",
  (value) => {
    const { path, line } = commandArgs(value);
    if (typeof path !== "string" || !path) throw new Error("Укажите путь файла");
    emit("openFile", { path, line: typeof line === "number" ? line : undefined });
  },
  {
    path: "string: путь файла в репозитории",
    line: "number (необязательно): строка",
  },
);
register(
  "ide.pipeline.pull.open",
  "Открыть pull request pipeline",
  "Открывает вкладку pull request, из которого запущен этот pipeline.",
  (value) => {
    const { number } = commandArgs(value);
    if (typeof number !== "number") throw new Error("Укажите номер pull request");
    emit("openPull", { number });
  },
  { number: "number: номер pull request" },
);

useTabReadout(() => {
  const note = recordId() ? `Pipeline #${recordId()}` : "Pipeline";
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
      pipeline.title || pipeline.name ? `Название: ${pipeline.title || pipeline.name}` : "",
      `Ветка: ${refLabel(pipeline.ref) || "нет"}, коммит: ${pipeline.sha || "нет"}`,
      pipeline.commitMessage ? `Коммит: ${pipeline.commitMessage}` : "",
      `Источник: ${sourceLabel(pipeline.source) || "нет"}`,
      pipeline.path ? `Workflow: ${pipeline.path}` : "",
      pipeline.pulls.length ? `PR: ${pipeline.pulls.map((item) => `#${item}`).join(", ")}` : "",
      `Создан: ${pipeline.createdAt}`,
      pipeline.duration !== null ? `Длительность: ${durationLabel(pipeline.duration)}` : "",
      data.usage.length
        ? `Usage: ${data.usage.map((item) => `${item.label} ${usageLabel(item.milliseconds)}`).join(", ")}`
        : "",
      `Джобов: ${data.jobs.length}`,
      shown.length ? `Джобы:\n${shown.join("\n")}` : "Джобов нет",
      data.annotations.length
        ? `Аннотации:\n${data.annotations
            .slice(0, 20)
            .map(
              (item) =>
                `${item.path}${item.startLine ? `:${item.startLine}` : ""}: ${item.message}`,
            )
            .join("\n")}`
        : "",
      data.jobsTruncated
        ? `Показано ${data.jobs.length} джобов, остальные — на ${props.host}.`
        : "",
    ),
  };
});
</script>

<template>
  <UiViewerPage>
    <UiLoader v-if="loading" class="note">загрузка: pipeline…</UiLoader>
    <UiHint v-else-if="error" size="xs" leading="inherit" class="note error" role="alert">{{
      error
    }}</UiHint>
    <UiArticle v-else-if="detail">
      <UiDetailHeader
        :state="PIPELINE_STATUS_LABEL[detail.pipeline.status]"
        :tone="stateTone"
        :title="heading"
        :number="detail.pipeline.id || detail.pipeline.number || undefined"
        :subtitle="subtitle"
        :external-href="detail.pipeline.webUrl"
        :host="host"
      >
        <template #meta>
          <span v-if="detail.pipeline.number">run #{{ detail.pipeline.number }}</span>
          <span v-if="detail.pipeline.attempt > 1">попытка {{ detail.pipeline.attempt }}</span>
          <span v-if="detail.pipeline.ref" class="mono">{{ refLabel(detail.pipeline.ref) }}</span>
          <span v-if="detail.pipeline.source">{{ sourceLabel(detail.pipeline.source) }}</span>
          <span v-if="detail.pipeline.sha" class="mono">{{ shortHash(detail.pipeline.sha) }}</span>
          <span v-if="detail.pipeline.commitMessage" :title="detail.pipeline.commitMessage">{{
            detail.pipeline.commitMessage
          }}</span>
          <button
            v-if="detail.pipeline.path"
            type="button"
            class="file"
            :title="`Открыть ${detail.pipeline.path}`"
            data-command="ide.pipeline.file.open"
            @click="openFile({ path: detail.pipeline.path })"
          >
            {{ detail.pipeline.path }}
          </button>
          <button
            v-for="pull in detail.pipeline.pulls"
            :key="pull"
            type="button"
            class="file"
            :title="`Открыть PR #${pull}`"
            data-command="ide.pipeline.pull.open"
            @click="commands.run('ide.pipeline.pull.open', { number: pull })"
          >
            PR #{{ pull }}
          </button>
          <span v-if="detail.pipeline.createdAt" :title="detail.pipeline.createdAt"
            >создан {{ relativeTime(detail.pipeline.createdAt) }}</span
          >
          <span v-if="durationLabel(detail.pipeline.duration)"
            >за {{ durationLabel(detail.pipeline.duration) }}</span
          >
          <span v-for="item in detail.usage" :key="item.label"
            >{{ item.label }} {{ usageLabel(item.milliseconds) }}</span
          >
        </template>
      </UiDetailHeader>

      <PipelineAnnotations
        :items="detail.annotations"
        :truncated="detail.annotationsTruncated"
        :host="host"
        @open="openFile"
      />

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
                <span v-if="job.labels.length" class="job-labels">{{ job.labels.join(", ") }}</span>
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
.file {
  color: var(--text-2);
  font-size: var(--fs-2xs);
}
.file:hover {
  color: var(--text);
  text-decoration: underline;
}
.job-status,
.job-time,
.job-number,
.job-labels {
  color: var(--muted);
  font-size: var(--fs-2xs);
}
.job-time,
.job-number,
.job-labels {
  font-family: var(--mono);
}
</style>
