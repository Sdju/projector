<script setup lang="ts">
import { computed } from "vue";
import ProjectorIcon from "../../../common/icons/ProjectorIcon.vue";
import UiButton from "../../../common/ui/UiButton.vue";
import { AgentMarkdown, AgentToolCall } from "../../agent-turns/index.ts";
import {
  formatClock,
  formatCost,
  formatDuration,
  formatTokens,
  kindLabel,
  statusLabel,
} from "../model/labels.ts";
import type { TrajectoryRecord, TrajectoryTurn } from "../model/types.ts";

const props = defineProps<{
  record: TrajectoryRecord;
  turn: TrajectoryTurn;
  root?: string;
}>();
const emit = defineEmits<{ close: []; openFile: [path: string] }>();

const usage = computed(() => props.record.usage ?? props.turn.usage);
const usageRows = computed(() => {
  const value = usage.value;
  if (!value) return [];
  return [
    { label: "Ввод", value: value.input },
    { label: "Выход", value: value.output },
    { label: "Из кэша", value: value.cacheRead },
    { label: "В кэш", value: value.cacheWrite },
  ].flatMap((row) =>
    row.value === undefined ? [] : [{ label: row.label, value: formatTokens(row.value) }],
  );
});
const metaRows = computed(() => {
  const record = props.record;
  const rows: { label: string; value: string }[] = [];
  const time = formatClock(record.startedAt);
  if (time) rows.push({ label: "Начало", value: time });
  if (record.endedAt !== undefined) {
    const end = formatClock(record.endedAt);
    if (end) rows.push({ label: "Конец", value: end });
  }
  if (record.durationMs !== undefined)
    rows.push({
      label: record.approximate ? "Длительность ≈" : "Длительность",
      value: formatDuration(record.durationMs),
    });
  if (record.timing?.ttftMs !== undefined)
    rows.push({ label: "TTFT", value: formatDuration(record.timing.ttftMs) });
  if (record.timing?.decodingMs !== undefined)
    rows.push({ label: "Генерация", value: formatDuration(record.timing.decodingMs) });
  if (record.status) rows.push({ label: "Состояние", value: statusLabel(record.status) });
  for (const [key, value] of Object.entries(record.meta ?? {}))
    if (value !== null && value !== undefined && value !== "")
      rows.push({ label: key, value: String(value) });
  return rows;
});
</script>

<template>
  <aside class="inspector" aria-label="Запись траектории">
    <header class="head">
      <div class="identity">
        <span class="kind" :data-kind="record.kind">{{ kindLabel(record.kind) }}</span>
        <strong class="title">{{ record.title }}</strong>
        <span class="where">Ход {{ turn.number || "—" }} · {{ turn.title }}</span>
      </div>
      <UiButton
        shape="icon"
        size="sm"
        title="Закрыть запись"
        aria-label="Закрыть запись"
        @click="emit('close')"
      >
        <ProjectorIcon name="x" aria-hidden="true" />
      </UiButton>
    </header>

    <div class="body">
      <section v-if="metaRows.length" class="section">
        <h4>Сведения</h4>
        <dl class="meta">
          <template v-for="row in metaRows" :key="row.label">
            <dt>{{ row.label }}</dt>
            <dd>{{ row.value }}</dd>
          </template>
        </dl>
      </section>

      <section v-if="usageRows.length || usage?.cost !== undefined" class="section">
        <h4>Токены</h4>
        <dl class="meta">
          <template v-for="row in usageRows" :key="row.label">
            <dt>{{ row.label }}</dt>
            <dd>{{ row.value }}</dd>
          </template>
          <template v-if="usage?.cost !== undefined">
            <dt>Цена</dt>
            <dd>{{ formatCost(usage.cost) }}</dd>
          </template>
        </dl>
      </section>

      <section v-if="turn.context" class="section">
        <h4>Контекст</h4>
        <p class="plain">
          {{ formatTokens(turn.context.used) }} из {{ formatTokens(turn.context.size) }}
          <template v-if="turn.context.model"> · {{ turn.context.model }}</template>
        </p>
      </section>

      <section v-if="record.kind === 'tool' || record.kind === 'subtool'" class="section">
        <h4>Инструмент</h4>
        <AgentToolCall
          v-if="record.tool"
          :tool="record.tool"
          :root="root"
          @open="(path) => emit('openFile', path)"
        />
        <p v-else class="plain">Данные вызова не сохранились.</p>
      </section>

      <section v-else-if="record.kind === 'task'" class="section">
        <h4>Задача</h4>
        <p v-if="record.task?.prompt" class="plain">{{ record.task.prompt }}</p>
        <p v-if="record.task?.summary" class="plain">{{ record.task.summary }}</p>
        <ol v-if="record.task?.log?.length" class="log">
          <li v-for="(line, index) in record.task.log" :key="index">{{ line }}</li>
        </ol>
        <p
          v-if="!record.task?.prompt && !record.task?.summary && !record.task?.log?.length"
          class="plain"
        >
          Подробности задачи не записаны.
        </p>
      </section>

      <section v-else-if="record.detail" class="section">
        <h4>Содержимое</h4>
        <AgentMarkdown
          v-if="record.kind === 'user' || record.kind === 'assistant' || record.kind === 'thought'"
          :text="record.detail"
        />
        <pre v-else class="text">{{ record.detail }}</pre>
      </section>

      <section v-if="record.input && !record.tool" class="section">
        <h4>Ввод</h4>
        <pre class="text">{{ record.input }}</pre>
      </section>
      <section v-if="record.output && !record.tool" class="section">
        <h4>Вывод</h4>
        <pre class="text">{{ record.output }}</pre>
      </section>
    </div>
  </aside>
</template>

<style scoped>
.inspector {
  display: flex;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
  border-left: 1px solid var(--line);
  background: var(--bg);
}
.head {
  display: flex;
  flex: none;
  align-items: flex-start;
  gap: 8px;
  padding: 8px 8px 8px 12px;
  border-bottom: 1px solid var(--line);
}
.identity {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  gap: 2px;
}
.kind {
  align-self: flex-start;
  padding: 1px 5px;
  border-radius: var(--r-sm);
  background: var(--bg-3);
  color: var(--muted);
  font-size: 10px;
}
.kind[data-kind="assistant"] {
  color: var(--info);
}
.kind[data-kind="tool"],
.kind[data-kind="subtool"],
.kind[data-kind="task"] {
  color: var(--warn);
}
.kind[data-kind="context"],
.kind[data-kind="system"],
.kind[data-kind="compaction"] {
  color: var(--run);
}
.title {
  overflow: hidden;
  font-size: var(--fs-sm);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.where {
  overflow: hidden;
  color: var(--faint);
  font-size: var(--fs-2xs);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.body {
  min-height: 0;
  overflow: auto;
  padding: 4px 12px 16px;
}
.section {
  padding: 8px 0;
  border-bottom: 1px solid color-mix(in srgb, var(--line) 60%, transparent);
}
h4 {
  margin: 0 0 6px;
  color: var(--faint);
  font-size: var(--fs-2xs);
  font-weight: 600;
  letter-spacing: 0.03em;
  text-transform: uppercase;
}
.meta {
  display: grid;
  grid-template-columns: minmax(80px, auto) minmax(0, 1fr);
  gap: 3px 10px;
  margin: 0;
  font-size: var(--fs-2xs);
}
.meta dt {
  color: var(--faint);
}
.meta dd {
  margin: 0;
  overflow-wrap: anywhere;
  color: var(--text-2);
}
.plain {
  margin: 0 0 6px;
  color: var(--text-2);
  font-size: var(--fs-xs);
  white-space: pre-wrap;
}
.log {
  margin: 0;
  padding-left: 18px;
  color: var(--text-2);
  font-size: var(--fs-2xs);
}
.text {
  max-height: 360px;
  margin: 0;
  overflow: auto;
  padding: 6px 8px;
  border: 1px solid var(--line);
  border-radius: var(--r-sm);
  background: var(--bg-2);
  color: var(--text-2);
  font: var(--fs-2xs) var(--mono);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
@media (max-width: 760px) {
  .inspector {
    border-top: 1px solid var(--line);
    border-left: 0;
    max-height: 44%;
  }
}
</style>
