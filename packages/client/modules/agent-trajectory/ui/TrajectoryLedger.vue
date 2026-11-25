<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import ProjectorIcon from "../../../common/icons/ProjectorIcon.vue";
import UiScrollArea from "../../../common/ui/UiScrollArea.vue";
import UiSpinner from "../../../common/ui/UiSpinner.vue";
import UiVirtualList from "../../../common/ui/UiVirtualList.vue";
import { formatElapsed, useElapsedClock } from "../../agent-core/index.ts";
import {
  formatClock,
  formatCost,
  formatDuration,
  formatTokens,
  kindLabel,
  kindShort,
  statusLabel,
} from "../model/labels.ts";
import type { TrajectoryData, TrajectoryRecord, TrajectoryTurn } from "../model/types.ts";

const props = defineProps<{
  data: TrajectoryData;
  selectedId: string | null;
  focusIds: ReadonlySet<string> | null;
}>();
const emit = defineEmits<{
  select: [id: string];
  toggle: [turn: number];
}>();

type LedgerRow =
  | { type: "turn"; key: string; turn: TrajectoryTurn }
  | { type: "record"; key: string; record: TrajectoryRecord; turn: TrajectoryTurn; depth: number };

type TurnRow = Extract<LedgerRow, { type: "turn" }>;
type RecordRow = Extract<LedgerRow, { type: "record" }>;
const turnRow = (row: LedgerRow) => row as TurnRow;
const recordRow = (row: LedgerRow) => row as RecordRow;

const collapsed = ref<ReadonlySet<number>>(new Set());
const scrollArea = ref<InstanceType<typeof UiScrollArea>>();
const list = ref<{ scrollToIndex: (index: number) => void }>();
const scrollElement = computed(() => scrollArea.value?.element ?? null);
const now = useElapsedClock();

const rows = computed<LedgerRow[]>(() => {
  const result: LedgerRow[] = [];
  for (const turn of props.data.turns) {
    result.push({ type: "turn", key: `turn:${turn.number}:${turn.id}`, turn });
    if (collapsed.value.has(turn.number)) continue;
    for (const record of turn.records)
      result.push({
        type: "record",
        key: `record:${record.id}`,
        record,
        turn,
        depth: record.parentId === undefined ? 0 : 1,
      });
  }
  return result;
});

function rowKey(row: LedgerRow): string {
  return row.key;
}

function rowSize(row: LedgerRow): number {
  return row.type === "turn" ? 40 : 36;
}

function toggle(turn: TrajectoryTurn) {
  const next = new Set(collapsed.value);
  if (next.has(turn.number)) next.delete(turn.number);
  else next.add(turn.number);
  collapsed.value = next;
  emit("toggle", turn.number);
}

function reveal(id: string) {
  const index = rows.value.findIndex((row) => row.type === "record" && row.record.id === id);
  if (index < 0) return;
  void nextTick(() => list.value?.scrollToIndex(index));
}

defineExpose({ reveal });

watch(
  () => props.selectedId,
  (id) => {
    if (id) reveal(id);
  },
);

function liveDuration(record: TrajectoryRecord): string {
  if (record.status === "running" && record.startedAt !== undefined)
    return formatElapsed(now.value - record.startedAt);
  return formatDuration(record.durationMs);
}

function durationTitle(record: TrajectoryRecord): string {
  if (record.status === "running") return "Выполняется";
  if (record.approximate) return "Длительность оценена по соседним записям";
  if (record.durationMs === undefined) return "Длительность не записана";
  return `Длительность: ${formatDuration(record.durationMs)}`;
}

function turnMeta(turn: TrajectoryTurn): string {
  const parts = [formatClock(turn.startedAt)];
  if (turn.usage?.input !== undefined || turn.usage?.output !== undefined)
    parts.push(`токены: ${formatTokens((turn.usage.input ?? 0) + (turn.usage.output ?? 0))}`);
  if (turn.usage?.cost !== undefined) parts.push(`цена: ${formatCost(turn.usage.cost)}`);
  if (turn.context)
    parts.push(
      `контекст ${Math.round((turn.context.used / Math.max(1, turn.context.size)) * 100)}%`,
    );
  return parts.filter(Boolean).join(" · ");
}

function recordText(record: TrajectoryRecord): string {
  const text = record.text || record.detail?.replace(/\s+/g, " ").trim().slice(0, 180) || "";
  return text === record.title ? "" : text;
}

function recordStatus(record: TrajectoryRecord): string {
  return record.status && record.status !== "done" ? statusLabel(record.status) : "";
}

function isDim(record: TrajectoryRecord): boolean {
  return props.focusIds !== null && !props.focusIds.has(record.id);
}
</script>

<template>
  <UiScrollArea ref="scrollArea" class="ledger">
    <UiVirtualList
      v-slot="{ rows: visibleRows, paddingAfter }"
      ref="list"
      :items="rows"
      :item-key="rowKey"
      :estimate-size="rowSize"
      :scroll-element="scrollElement"
      :overscan="8"
    >
      <div class="rows" role="list">
        <template v-for="{ item: row, index, key, gapBefore } in visibleRows" :key="key">
          <div v-if="gapBefore" :style="{ height: `${gapBefore}px` }" aria-hidden="true" />
          <template v-if="row.type === 'turn'">
            <button
              type="button"
              class="turn"
              :data-virtual-index="index"
              :aria-expanded="!collapsed.has(turnRow(row).turn.number)"
              :aria-label="`Ход ${turnRow(row).turn.number}: ${turnRow(row).turn.title}`"
              @click="toggle(turnRow(row).turn)"
            >
              <span class="turn-number">{{ turnRow(row).turn.number || "—" }}</span>
              <span class="turn-title">{{ turnRow(row).turn.title }}</span>
              <span class="turn-meta">{{ turnMeta(turnRow(row).turn) }}</span>
              <ProjectorIcon
                name="chevron-right"
                class="turn-chevron"
                :class="{ open: !collapsed.has(turnRow(row).turn.number) }"
                aria-hidden="true"
              />
            </button>
          </template>
          <template v-if="row.type === 'record'">
            <button
              type="button"
              class="record"
              :class="{
                selected: selectedId === recordRow(row).record.id,
                dim: isDim(recordRow(row).record),
              }"
              :style="{ paddingLeft: `${12 + recordRow(row).depth * 16}px` }"
              :data-virtual-index="index"
              :data-record-id="recordRow(row).record.id"
              :aria-current="selectedId === recordRow(row).record.id ? 'true' : undefined"
              @click="emit('select', recordRow(row).record.id)"
            >
              <span class="kind" :data-kind="recordRow(row).record.kind">{{
                kindShort(recordRow(row).record.kind)
              }}</span>
              <span class="record-main">
                <span class="record-title">{{ recordRow(row).record.title }}</span>
                <span v-if="recordText(recordRow(row).record)" class="record-text">{{
                  recordText(recordRow(row).record)
                }}</span>
              </span>
              <span
                v-if="liveDuration(recordRow(row).record)"
                class="record-time"
                :title="durationTitle(recordRow(row).record)"
                >{{ liveDuration(recordRow(row).record) }}</span
              >
              <span
                v-if="recordStatus(recordRow(row).record)"
                class="record-status"
                :data-status="recordRow(row).record.status"
              >
                {{ recordStatus(recordRow(row).record) }}
              </span>
              <UiSpinner v-if="recordRow(row).record.status === 'running'" class="record-icon" />
              <ProjectorIcon
                v-else-if="recordRow(row).record.status === 'error'"
                name="circle-alert"
                class="record-icon error"
                :aria-label="kindLabel(recordRow(row).record.kind)"
              />
              <ProjectorIcon
                v-else
                name="chevron-right"
                class="record-icon muted"
                aria-hidden="true"
              />
            </button>
          </template>
        </template>
        <div :style="{ height: `${paddingAfter}px` }" aria-hidden="true" />
      </div>
    </UiVirtualList>
    <p v-if="!rows.length" class="empty">Пока нет записей: отправьте сообщение агенту.</p>
  </UiScrollArea>
</template>

<style scoped>
.ledger {
  min-width: 0;
  min-height: 0;
}
.rows {
  display: flex;
  flex-direction: column;
}
.turn {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 40px;
  padding: 0 12px;
  border: 0;
  border-bottom: 1px solid var(--line);
  background: color-mix(in srgb, var(--bg-2) 74%, transparent);
  color: var(--text);
  text-align: start;
  cursor: pointer;
}
.turn:hover {
  background: var(--hover);
}
.turn-number {
  flex: none;
  min-width: 20px;
  color: var(--faint);
  font: var(--fs-2xs) var(--mono);
  font-variant-numeric: tabular-nums;
}
.turn-title {
  min-width: 0;
  overflow: hidden;
  font-size: var(--fs-xs);
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.turn-meta {
  margin-left: auto;
  overflow: hidden;
  color: var(--faint);
  font-size: var(--fs-2xs);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.turn-chevron {
  flex: none;
  width: 12px;
  height: 12px;
  color: var(--faint);
  transition: transform var(--t-fast);
}
.turn-chevron.open {
  transform: rotate(90deg);
}
.record {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 36px;
  padding: 0 12px;
  border: 0;
  border-bottom: 1px solid color-mix(in srgb, var(--line) 45%, transparent);
  background: transparent;
  color: var(--text-2);
  text-align: start;
  cursor: pointer;
}
.record:hover {
  background: var(--hover);
}
.record.selected {
  background: color-mix(in srgb, var(--info) 12%, transparent);
  box-shadow: inset 2px 0 0 var(--info);
  color: var(--text);
}
.record.dim {
  opacity: 0.34;
}
.kind {
  flex: none;
  width: 58px;
  overflow: hidden;
  padding: 1px 4px;
  border-radius: var(--r-sm);
  background: var(--bg-3);
  color: var(--muted);
  font-size: 10px;
  text-align: center;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.kind[data-kind="user"] {
  color: var(--text);
}
.kind[data-kind="assistant"] {
  color: var(--info);
}
.kind[data-kind="thought"] {
  color: color-mix(in srgb, var(--info) 70%, var(--muted));
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
.record-main {
  display: flex;
  min-width: 0;
  flex: 1;
  align-items: baseline;
  gap: 8px;
}
.record-title {
  flex: none;
  max-width: 45%;
  overflow: hidden;
  color: var(--text);
  font-size: var(--fs-xs);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.record-text {
  min-width: 0;
  overflow: hidden;
  color: var(--faint);
  font-size: var(--fs-2xs);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.record-time {
  flex: none;
  color: var(--muted);
  font: var(--fs-2xs) var(--mono);
  font-variant-numeric: tabular-nums;
}
.record-status {
  flex: none;
  color: var(--faint);
  font-size: 10px;
}
.record-status[data-status="error"] {
  color: var(--err);
}
.record-status[data-status="running"] {
  color: var(--info);
}
.record-icon {
  flex: none;
  width: 12px;
  height: 12px;
  color: var(--faint);
}
.record-icon.error {
  color: var(--err);
}
.record-icon.muted {
  color: transparent;
}
.record:hover .record-icon.muted,
.record.selected .record-icon.muted {
  color: var(--faint);
}
.empty {
  margin: 0;
  padding: var(--sp-5);
  color: var(--muted);
  font-size: var(--fs-sm);
  text-align: center;
}
@media (prefers-reduced-motion: reduce) {
  .turn-chevron {
    transition: none;
  }
}
@container (max-width: 420px) {
  .turn-meta,
  .record-text,
  .record-status {
    display: none;
  }
  .kind {
    width: 44px;
  }
  .record-title {
    max-width: none;
    flex: 1;
  }
}
</style>
