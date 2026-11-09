<script setup lang="ts">
import UiArticle from "../../../../../common/ui/UiArticle.vue";
import UiDetailHeader from "../../../../../common/ui/UiDetailHeader.vue";
import UiHeading from "../../../../../common/ui/UiHeading.vue";
import UiHint from "../../../../../common/ui/UiHint.vue";
import UiViewerPage from "../../../../../common/ui/UiViewerPage.vue";
import { computed } from "vue";
import { relativeTime } from "../../../../../common/utilities/commit-format.ts";
import { readoutLines, useTabReadout } from "../../../../../common/utilities/tab-readout.ts";
import { useCommandRegistrar, useCommandScope } from "../../../../../common/utilities/commands.ts";
import { useJobDetail } from "../lib/detail.ts";
import {
  durationLabel,
  PIPELINE_STATUS_LABEL,
  PIPELINE_STATUS_TONE,
  refLabel,
} from "@projector/core/modules/workspace/index.ts";

/** Job tab: status, stage and the readonly trace of one CI job. */
const props = withDefaults(defineProps<{ projectId: string; id: number; host?: string }>(), {
  host: "GitLab",
});
const { detail, loading, error, reload } = useJobDetail(
  () => props.projectId,
  () => props.id,
);
const stateTone = computed(() => {
  const status = detail.value?.job.status;
  if (!status) return "neutral";
  const tone = PIPELINE_STATUS_TONE[status];
  return tone === "warning" || tone === "success" || tone === "danger" ? tone : "neutral";
});
const commands = useCommandScope(`job:${props.projectId}:${props.id}`, () => ({
  surface: "job",
  projectId: props.projectId,
  jobId: props.id,
}));
const register = useCommandRegistrar(commands.scope);
register("ide.job.refresh", "Обновить джоб", "Перечитывает статус джоба и его readonly-лог.", () =>
  reload(),
);

useTabReadout(() => {
  const note = `Job #${props.id}`;
  if (error.value) return { note, text: `Ошибка: ${error.value}` };
  const data = detail.value;
  if (!data) return { note, text: "Загрузка…" };
  const job = data.job;
  const log = data.log.length > 20_000 ? `${data.log.slice(0, 20_000)}…` : data.log;
  return {
    note,
    text: readoutLines(
      `Состояние: ${PIPELINE_STATUS_LABEL[job.status]}`,
      `${job.name || `Job #${job.id}`}${job.stage ? ` (${job.stage})` : ""}`,
      `Ветка: ${job.ref || "нет"}`,
      `Создан: ${job.createdAt}`,
      job.duration !== null ? `Длительность: ${durationLabel(job.duration)}` : "",
      job.failureReason ? `Причина: ${job.failureReason}` : "",
      job.allowFailure ? "Разрешено падение" : "",
      data.logTruncated ? "Лог показан не полностью." : "",
      log ? `Лог:\n${log}` : "Лог пуст",
    ),
  };
});
</script>

<template>
  <UiViewerPage>
    <UiHint v-if="loading" size="xs" leading="inherit" class="note" role="status"
      >загрузка: джоб…</UiHint
    >
    <UiHint v-else-if="error" size="xs" leading="inherit" class="note error" role="alert">{{
      error
    }}</UiHint>
    <UiArticle v-else-if="detail" :width="1100">
      <UiDetailHeader
        :state="PIPELINE_STATUS_LABEL[detail.job.status]"
        :tone="stateTone"
        :title="detail.job.name || 'Job'"
        :number="detail.job.id"
        :external-href="detail.job.webUrl"
        :host="host"
      >
        <template #meta>
          <span v-if="detail.job.stage">{{ detail.job.stage }}</span>
          <span v-if="detail.job.ref" class="mono">{{ refLabel(detail.job.ref) }}</span>
          <span v-if="detail.job.createdAt" :title="detail.job.createdAt"
            >создан {{ relativeTime(detail.job.createdAt) }}</span
          >
          <span v-if="durationLabel(detail.job.duration)"
            >за {{ durationLabel(detail.job.duration) }}</span
          >
          <span v-if="detail.job.allowFailure">падение разрешено</span>
        </template>
      </UiDetailHeader>
      <UiHint
        v-if="detail.job.failureReason"
        size="xs"
        leading="inherit"
        :space-before="2"
        class="note"
        >Причина: {{ detail.job.failureReason }}</UiHint
      >

      <UiHeading as="h3" size="sm" tone="secondary" :space-before="4" :space-after="2"
        >Лог</UiHeading
      >
      <UiHint v-if="!detail.log" size="xs" leading="inherit" class="note"
        >Лог пуст или недоступен</UiHint
      >
      <pre v-else class="trace">{{ detail.log }}</pre>
      <UiHint v-if="detail.logTruncated" size="xs" leading="inherit" :space-before="2" class="note">
        Показаны первые 2 MiB лога. Полный лог — на {{ host }}.
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
.trace {
  margin: 0;
  padding: var(--sp-3);
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  background: var(--bg-sunken, var(--active));
  color: var(--text-2);
  font: var(--fs-xs) / 1.5 var(--mono);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  tab-size: 2;
}
</style>
