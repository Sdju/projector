<script setup lang="ts">
import { computed, ref } from "vue";
import { formatClock, formatDuration, kindLabel, statusLabel } from "../model/labels.ts";
import type { TrajectoryData, TrajectoryRecord } from "../model/types.ts";
import type {
  TrajectoryScale,
  TrajectoryTimeRange,
  TrajectoryTimeline,
} from "../model/timeline.ts";

const props = defineProps<{
  data: TrajectoryData;
  model: TrajectoryTimeline;
  scale: TrajectoryScale;
  range: TrajectoryTimeRange | null;
  selectedId: string | null;
  focusIds: ReadonlySet<string> | null;
}>();
const emit = defineEmits<{
  select: [id: string];
  range: [range: TrajectoryTimeRange | null];
}>();

const track = ref<HTMLElement>();
const draft = ref<TrajectoryTimeRange | null>(null);
const hovered = ref<string | null>(null);
const MINIMUM_DRAG_PX = 3;

interface Drag {
  pointerId: number;
  clientX: number;
  anchor: number;
  recordId: string | null;
}

let drag: Drag | null = null;

const duration = computed(() => Math.max(1, props.model.end - props.model.start));

function fractionAt(event: PointerEvent): number {
  const element = track.value;
  if (!element) return 0;
  const bounds = element.getBoundingClientRect();
  return Math.min(1, Math.max(0, (event.clientX - bounds.left) / Math.max(1, bounds.width)));
}

function timeAt(fraction: number): number {
  return props.model.start + fraction * duration.value;
}

function recordAt(event: PointerEvent): string | null {
  const target = event.target instanceof HTMLElement ? event.target : null;
  return target?.closest<HTMLElement>("[data-record-id]")?.dataset.recordId ?? null;
}

function ordered(left: number, right: number): TrajectoryTimeRange {
  return left <= right ? { start: left, end: right } : { start: right, end: left };
}

function onPointerDown(event: PointerEvent) {
  if (event.button !== 0) return;
  const anchor = timeAt(fractionAt(event));
  drag = {
    pointerId: event.pointerId,
    clientX: event.clientX,
    anchor,
    recordId: recordAt(event),
  };
  draft.value = { start: anchor, end: anchor };
  const element = event.currentTarget;
  if (element instanceof HTMLElement) element.setPointerCapture(event.pointerId);
}

function onPointerLeave() {
  if (drag === null) hovered.value = null;
}

function onPointerMove(event: PointerEvent) {
  const target = event.target instanceof HTMLElement ? event.target : null;
  hovered.value = target?.closest<HTMLElement>("[data-record-id]")?.dataset.recordId ?? null;
  if (!drag || drag.pointerId !== event.pointerId) return;
  draft.value = ordered(drag.anchor, timeAt(fractionAt(event)));
}

function onPointerUp(event: PointerEvent) {
  const current = drag;
  if (!current || current.pointerId !== event.pointerId) return;
  drag = null;
  const point = timeAt(fractionAt(event));
  const moved = Math.abs(event.clientX - current.clientX) >= MINIMUM_DRAG_PX;
  draft.value = null;
  if (!moved) {
    if (current.recordId) emit("select", current.recordId);
    else emit("range", null);
    return;
  }
  const range = ordered(current.anchor, point);
  emit("range", range.end - range.start > 0 ? range : null);
}

function onPointerCancel() {
  drag = null;
  draft.value = null;
  hovered.value = null;
}

function onKeyDown(event: KeyboardEvent) {
  if (event.key !== "Escape" || props.range === null) return;
  event.preventDefault();
  emit("range", null);
}

const activeRange = computed(() => draft.value ?? props.range);
const rangeStyle = computed(() => {
  const range = activeRange.value;
  if (!range) return undefined;
  const start = Math.max(props.model.start, Math.min(props.model.end, range.start));
  const end = Math.max(props.model.start, Math.min(props.model.end, range.end));
  const left = ((start - props.model.start) / duration.value) * 100;
  const width = Math.max(0.4, ((end - start) / duration.value) * 100);
  return { left: `${left}%`, width: `${width}%` };
});

function spanStyle(span: TrajectoryTimeline["spans"][number]) {
  const left = ((span.start - props.model.start) / duration.value) * 100;
  const width = Math.max(0, ((span.end - span.start) / duration.value) * 100);
  return {
    left: `${left}%`,
    width: `${width}%`,
    top: `${span.lane * 15}px`,
  };
}

function spanTitle(span: TrajectoryTimeline["spans"][number]): string {
  const record = span.record;
  const lines = [`${kindLabel(record.kind)} · ${record.title}`];
  const clock = formatClock(record.startedAt);
  if (clock) lines.push(clock);
  if (record.durationMs) lines.push(formatDuration(record.durationMs));
  if (record.timing?.ttftMs !== undefined)
    lines.push(`TTFT: ${formatDuration(record.timing.ttftMs)}`);
  if (record.timing?.decodingMs !== undefined)
    lines.push(`генерация: ${formatDuration(record.timing.decodingMs)}`);
  if (record.status && record.status !== "done") lines.push(statusLabel(record.status));
  return lines.filter(Boolean).join("\n");
}

function isSelected(record: TrajectoryRecord): boolean {
  return props.selectedId === record.id;
}

function isFocused(record: TrajectoryRecord): boolean {
  return props.focusIds === null || props.focusIds.has(record.id);
}

/** Records that intersect the active drag or committed selection. */
const rangeIds = computed(() => {
  const range = activeRange.value;
  if (!range) return null;
  return new Set(
    props.model.spans
      .filter((span) => span.start <= range.end && span.end >= range.start)
      .map((span) => span.record.id),
  );
});

function isInsideRange(record: TrajectoryRecord): boolean {
  return rangeIds.value?.has(record.id) ?? false;
}

const laneLabels = ["Ввод", "Модель", "Инструменты"];
</script>

<template>
  <section class="overview" aria-label="Обзор траектории">
    <div class="plot">
      <div class="labels" aria-hidden="true">
        <span
          v-for="(label, index) in laneLabels"
          :key="label"
          :style="{ top: `${10 + index * 15}px` }"
        >
          {{ label }}
        </span>
      </div>
      <div
        ref="track"
        class="track"
        tabindex="0"
        role="group"
        aria-label="Шкала записей: клик выбирает запись, протяжка задаёт интервал"
        @pointerdown="onPointerDown"
        @pointermove="onPointerMove"
        @pointerup="onPointerUp"
        @pointercancel="onPointerCancel"
        @pointerleave="onPointerLeave"
        @dblclick="emit('range', null)"
        @keydown="onKeyDown"
      >
        <div
          v-for="boundary in model.boundaries"
          :key="boundary.turn"
          class="boundary"
          :style="{ left: `${((boundary.time - model.start) / duration) * 100}%` }"
          aria-hidden="true"
        />
        <div
          v-if="rangeStyle"
          class="selection"
          :class="{ drafting: draft !== null }"
          :style="rangeStyle"
          aria-hidden="true"
        />
        <span
          v-for="span in model.spans"
          :key="span.record.id"
          class="span"
          :class="[`kind-${span.record.kind}`, { dim: !isFocused(span.record) }]"
          :style="spanStyle(span)"
          :data-record-id="span.record.id"
          :data-selected="isSelected(span.record) || isInsideRange(span.record) || undefined"
          :data-error="span.record.status === 'error' || undefined"
          :data-hovered="hovered === span.record.id || undefined"
          :title="spanTitle(span)"
          aria-hidden="true"
        />
        <div v-if="!model.spans.length" class="empty">Нет записей для шкалы</div>
      </div>
    </div>
    <p class="scale-hint">
      {{ scale === "sequence" ? "По порядку" : "По записанному времени; простои сжаты" }}
    </p>
  </section>
</template>

<style scoped>
.overview {
  flex: none;
  border-bottom: 1px solid var(--line);
}
.plot {
  display: grid;
  grid-template-columns: 58px minmax(0, 1fr);
  height: 60px;
  background: var(--bg-2);
}
.labels {
  position: relative;
  border-right: 1px solid var(--line);
  color: var(--faint);
  font-size: 10px;
  line-height: 1;
}
.labels span {
  position: absolute;
  right: 5px;
  white-space: nowrap;
}
.track {
  position: relative;
  overflow: hidden;
  cursor: crosshair;
  touch-action: none;
}
.track:focus-visible {
  outline: 1px solid var(--focus, var(--info));
  outline-offset: -1px;
}
.boundary {
  position: absolute;
  z-index: 0;
  top: 0;
  bottom: 0;
  width: 1px;
  background: var(--line);
}
.span {
  position: absolute;
  z-index: 1;
  height: 9px;
  min-width: 2px;
  padding: 0;
  border: 0;
  border-radius: 2px;
  background: var(--muted);
  opacity: 0.72;
  cursor: pointer;
}
.span.kind-user {
  background: var(--text-2);
}
.span.kind-assistant {
  background: var(--info);
  opacity: 1;
}
.span.kind-thought {
  background: color-mix(in srgb, var(--info) 55%, var(--muted));
}
.span.kind-tool,
.span.kind-subtool {
  background: var(--warn);
  opacity: 0.9;
}
.span.kind-task {
  background: color-mix(in srgb, var(--warn) 60%, var(--info));
}
.span.kind-note,
.span.kind-judge,
.span.kind-context,
.span.kind-system,
.span.kind-compaction {
  background: color-mix(in srgb, var(--run) 70%, var(--muted));
}
.span[data-error="true"] {
  background: var(--err);
}
.span.dim {
  opacity: 0.16;
}
.span[data-selected="true"] {
  z-index: 3;
  opacity: 1;
  box-shadow:
    0 0 0 1px var(--bg),
    0 0 0 2px var(--info);
}
.span[data-hovered="true"]:not([data-selected="true"]) {
  z-index: 2;
  opacity: 1;
  box-shadow:
    0 0 0 1px var(--bg),
    0 0 0 2px var(--muted);
}
.selection {
  position: absolute;
  z-index: 2;
  top: 0;
  bottom: 0;
  min-width: 1px;
  background: color-mix(in srgb, var(--info) 16%, transparent);
  border-left: 2px solid var(--info);
  border-right: 2px solid var(--info);
  pointer-events: none;
}
.selection.drafting {
  background: color-mix(in srgb, var(--info) 22%, transparent);
}
.scale-hint {
  margin: 0;
  padding: 3px 8px 4px 58px;
  color: var(--faint);
  font-size: var(--fs-2xs);
}
.empty {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  color: var(--faint);
  font-size: var(--fs-2xs);
}
@media (prefers-reduced-motion: reduce) {
  .span {
    transition: none;
  }
}
@container (max-width: 420px) {
  .plot {
    grid-template-columns: 48px minmax(0, 1fr);
  }
  .scale-hint {
    display: none;
  }
}
</style>
