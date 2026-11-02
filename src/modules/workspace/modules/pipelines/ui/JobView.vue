<script setup lang="ts">
import UiHeading from "../../../../../common/ui/UiHeading.vue";
import UiHint from "../../../../../common/ui/UiHint.vue";
import UiInline from "../../../../../common/ui/UiInline.vue";
import { relativeTime } from "../../../../../common/utilities/commit-format.ts";
import { readoutLines, useTabReadout } from "../../../../../common/utilities/tab-readout.ts";
import { useCommandRegistrar, useCommandScope } from "../../../../../common/utilities/commands.ts";
import { useJobDetail } from "../lib/detail.ts";
import { durationLabel, PIPELINE_STATUS_LABEL } from "../lib/status.ts";
import IconExternal from "~icons/lucide/external-link";

/** Job tab: status, stage and the readonly trace of one CI job. */
const props = withDefaults(defineProps<{ projectId: string; id: number; host?: string }>(), {
  host: "GitLab",
});
const { detail, loading, error, reload } = useJobDetail(
  () => props.projectId,
  () => props.id,
);
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
  <div class="job-view">
    <UiHint v-if="loading" size="xs" leading="inherit" class="note" role="status"
      >загрузка: джоб…</UiHint
    >
    <UiHint v-else-if="error" size="xs" leading="inherit" class="note error" role="alert">{{
      error
    }}</UiHint>
    <article v-else-if="detail" class="article">
      <UiInline as="header" class="head" align="baseline" wrap justify="normal">
        <span class="state" :class="detail.job.status">{{
          PIPELINE_STATUS_LABEL[detail.job.status]
        }}</span>
        <UiHeading as="h2" size="lg" weight="semibold" :space-after="0">
          {{ detail.job.name || "Job" }} <span class="number">#{{ detail.job.id }}</span>
        </UiHeading>
      </UiInline>
      <UiInline as="p" class="meta" wrap>
        <span v-if="detail.job.stage">{{ detail.job.stage }}</span>
        <span v-if="detail.job.ref" class="mono">{{ detail.job.ref }}</span>
        <span v-if="detail.job.createdAt" :title="detail.job.createdAt"
          >создан {{ relativeTime(detail.job.createdAt) }}</span
        >
        <span v-if="durationLabel(detail.job.duration)"
          >за {{ durationLabel(detail.job.duration) }}</span
        >
        <span v-if="detail.job.allowFailure">падение разрешено</span>
        <UiInline
          as="a"
          inline
          :gap="1"
          justify="normal"
          v-if="detail.job.webUrl"
          class="external"
          :href="detail.job.webUrl"
          target="_blank"
          rel="noopener noreferrer"
        >
          <IconExternal aria-hidden="true" />на {{ host }}
        </UiInline>
      </UiInline>
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
    </article>
  </div>
</template>

<style scoped>
.job-view {
  height: 100%;
  overflow: auto;
  padding: var(--sp-4);
}
.article {
  max-width: 1100px;
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
.note.error {
  color: var(--err);
}
</style>
