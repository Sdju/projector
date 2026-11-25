<script setup lang="ts">
import { computed, ref, watch } from "vue";
import ProjectorIcon from "../../../common/icons/ProjectorIcon.vue";
import UiEmpty from "../../../common/ui/UiEmpty.vue";
import {
  hasTimedRecords,
  deriveTrajectoryTimeline,
  trajectoryFocusIds,
  type TrajectoryScale,
  type TrajectoryTimeRange,
} from "../model/timeline.ts";
import { formatCost, formatTokens } from "../model/labels.ts";
import type { TrajectoryData, TrajectoryRecord, TrajectoryTurn } from "../model/types.ts";
import TrajectoryInspector from "./TrajectoryInspector.vue";
import TrajectoryLedger from "./TrajectoryLedger.vue";
import TrajectoryOverview from "./TrajectoryOverview.vue";

const props = withDefaults(
  defineProps<{
    /** The whole panel's input; see `model/types.ts`. */
    data: TrajectoryData;
    /** The card title; the kind of ledger is a chat answer by default. */
    title?: string;
    /** A one-line explanation under the title; defaults to `data.notice`. */
    subtitle?: string;
    /** Project folder for relative tool paths. */
    root?: string;
  }>(),
  { title: "Траектория", subtitle: undefined, root: undefined },
);
const selected = defineModel<string | null>("selected", { default: null });
const emit = defineEmits<{ openFile: [path: string] }>();

const scale = ref<TrajectoryScale>("sequence");
const range = ref<TrajectoryTimeRange | null>(null);
const ledger = ref<InstanceType<typeof TrajectoryLedger>>();

const durationAvailable = computed(() => hasTimedRecords(props.data));
const timeline = computed(() =>
  deriveTrajectoryTimeline(props.data, durationAvailable.value ? scale.value : "sequence"),
);
const focusIds = computed(() => trajectoryFocusIds(props.data, range.value, scale.value));
const selectedRecord = computed<TrajectoryRecord | undefined>(() =>
  selected.value === null
    ? undefined
    : props.data.records.find((record) => record.id === selected.value),
);
const selectedTurn = computed<TrajectoryTurn | undefined>(() => {
  const record = selectedRecord.value;
  if (!record) return undefined;
  return props.data.turns.find((turn) => turn.number === record.turn) ?? props.data.turns[0];
});

const available = computed(() => [
  { label: "ходы", on: props.data.counts.turns > 0 },
  { label: "инструменты", on: props.data.capabilities.tools },
  { label: "задачи", on: props.data.capabilities.tasks },
  { label: "usage", on: props.data.capabilities.usage },
  { label: "контекст", on: props.data.capabilities.context },
  { label: "сжатие", on: props.data.capabilities.compaction },
]);
const missing = computed(() =>
  [
    props.data.capabilities.steps ? "" : "шаги модели",
    props.data.capabilities.ttft ? "" : "TTFT",
  ].filter(Boolean),
);
const tokens = computed(() => {
  const usage = props.data.usage;
  const total = (usage.input ?? 0) + (usage.output ?? 0);
  return total > 0 ? `${formatTokens(total)} ток.` : "";
});
const cost = computed(() =>
  props.data.usage.cost === undefined ? "" : `цена ${formatCost(props.data.usage.cost)}`,
);

function choose(id: string) {
  selected.value = id;
  if (focusIds.value !== null && !focusIds.value.has(id)) range.value = null;
  ledger.value?.reveal(id);
}

function setScale(next: TrajectoryScale) {
  if (next === "duration" && !durationAvailable.value) return;
  scale.value = next;
  range.value = null;
}

function setRange(next: TrajectoryTimeRange | null) {
  range.value = next;
}

watch(
  () => [props.data.turns[0]?.id, props.data.records.length] as const,
  ([chatId], previous) => {
    if (previous === undefined || chatId !== previous[0]) {
      selected.value = null;
      range.value = null;
      scale.value = "sequence";
      return;
    }
    if (
      selected.value !== null &&
      !props.data.records.some((record) => record.id === selected.value)
    )
      selected.value = null;
    if (scale.value === "duration" && !hasTimedRecords(props.data)) scale.value = "sequence";
  },
);
</script>

<template>
  <section class="panel" aria-label="Траектория чата">
    <header class="head">
      <div class="heading">
        <ProjectorIcon name="list-tree" class="heading-icon" aria-hidden="true" />
        <div class="heading-text">
          <h2>{{ title }}</h2>
          <p v-if="subtitle ?? data.notice">{{ subtitle ?? data.notice }}</p>
        </div>
      </div>
      <div class="controls">
        <div class="scale" role="group" aria-label="Шкала обзора">
          <button type="button" :aria-pressed="scale === 'sequence'" @click="setScale('sequence')">
            Порядок
          </button>
          <button
            type="button"
            :aria-pressed="scale === 'duration'"
            :disabled="!durationAvailable"
            :title="
              durationAvailable
                ? 'Раскладывать по записанному времени'
                : 'В истории нет времён для этой шкалы'
            "
            @click="setScale('duration')"
          >
            Длительность
          </button>
        </div>
      </div>
    </header>

    <div class="stats">
      <span v-for="item in available" :key="item.label" class="cap" :data-on="item.on">
        {{ item.label }}
      </span>
      <span v-if="missing.length" class="missing">нет данных: {{ missing.join(" · ") }}</span>
      <span class="numbers">
        {{ data.counts.turns }} ход. · {{ data.counts.records }} записей
        <template v-if="data.counts.tools"> · {{ data.counts.tools }} вызовов</template>
        <template v-if="tokens"> · {{ tokens }}</template>
        <template v-if="cost"> · {{ cost }}</template>
        <template v-if="data.counts.errors"> · ошибок {{ data.counts.errors }}</template>
      </span>
    </div>

    <template v-if="data.records.length">
      <TrajectoryOverview
        v-if="timeline"
        :data="data"
        :model="timeline"
        :scale="scale"
        :range="range"
        :selected-id="selected"
        :focus-ids="focusIds"
        @select="choose"
        @range="setRange"
      />
      <div class="body" :class="{ inspected: selectedRecord !== undefined }">
        <TrajectoryLedger
          ref="ledger"
          :key="data.turns[0]?.id ?? 'empty'"
          :data="data"
          :selected-id="selected"
          :focus-ids="focusIds"
          @select="choose"
        />
        <TrajectoryInspector
          v-if="selectedRecord && selectedTurn"
          :record="selectedRecord"
          :turn="selectedTurn"
          :root="root"
          @close="selected = null"
          @open-file="emit('openFile', $event)"
        />
      </div>
    </template>
    <UiEmpty v-else align="start" density="regular">
      Пока нет записей. Откройте файл траектории или передайте документ из агента.
    </UiEmpty>
  </section>
</template>

<style scoped>
.panel {
  display: flex;
  flex: 1;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 320px;
  flex-direction: column;
  background: var(--bg);
  container-type: inline-size;
}
.head {
  display: flex;
  flex: none;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px 6px;
}
.heading {
  display: flex;
  min-width: 0;
  gap: 9px;
}
.heading-icon {
  width: 17px;
  height: 17px;
  margin-top: 2px;
  flex: none;
  color: var(--info);
}
.heading-text {
  min-width: 0;
}
h2 {
  margin: 0;
  font-size: var(--fs-sm);
  font-weight: 650;
}
.heading-text p {
  margin: 2px 0 0;
  color: var(--faint);
  font-size: var(--fs-2xs);
  line-height: 1.35;
}
.controls {
  display: flex;
  flex: none;
  align-items: center;
  gap: 6px;
}
.scale {
  display: inline-flex;
  padding: 2px;
  border: 1px solid var(--line);
  border-radius: var(--r-sm);
  background: var(--bg-2);
}
.scale button {
  padding: 3px 7px;
  border: 0;
  border-radius: 3px;
  background: transparent;
  color: var(--muted);
  font-size: var(--fs-2xs);
  cursor: pointer;
}
.scale button:hover:not(:disabled) {
  color: var(--text);
}
.scale button[aria-pressed="true"] {
  background: var(--hover);
  color: var(--text);
}
.scale button:disabled {
  cursor: default;
  opacity: 0.4;
}
.stats {
  display: flex;
  flex: none;
  align-items: center;
  flex-wrap: wrap;
  gap: 5px;
  padding: 0 12px 8px;
}
.cap {
  padding: 1px 5px;
  border: 1px solid var(--line);
  border-radius: var(--r-sm);
  color: var(--faint);
  font-size: 10px;
}
.cap[data-on="true"] {
  border-color: color-mix(in srgb, var(--info) 45%, var(--line));
  color: var(--info);
}
.missing {
  color: var(--faint);
  font-size: 10px;
}
.numbers {
  margin-left: auto;
  color: var(--faint);
  font-size: var(--fs-2xs);
  white-space: nowrap;
}
.body {
  display: grid;
  min-height: 0;
  flex: 1;
  grid-template-columns: minmax(0, 1fr);
  grid-template-rows: minmax(0, 1fr);
}
.body.inspected {
  grid-template-columns: minmax(0, 1fr) minmax(280px, 360px);
}
@container (max-width: 860px) {
  .body.inspected {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: minmax(0, 1fr) auto;
  }
  .body.inspected :deep(.inspector) {
    max-height: 44%;
    border-top: 1px solid var(--line);
    border-left: 0;
  }
}
@container (max-width: 560px) {
  .head {
    flex-direction: column;
    align-items: stretch;
  }
  .controls {
    justify-content: flex-end;
  }
  .numbers {
    width: 100%;
    margin-left: 0;
    white-space: normal;
  }
}
@container (max-width: 420px) {
  .heading-text p {
    display: none;
  }
  .numbers {
    display: none;
  }
  .stats {
    padding-bottom: 4px;
  }
}
</style>
