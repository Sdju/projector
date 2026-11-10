<script setup lang="ts">
import { computed } from "vue";
import type { UsageHeatDay } from "@ai-projector/core/modules/usage-analytics/index.ts";
import { countRu } from "../../../common/utilities/plural.ts";
import { formatDayLong, formatMonthShort, formatTokens } from "../model/format.ts";

const props = defineProps<{
  days: UsageHeatDay[];
  selected?: string | null;
}>();

const emit = defineEmits<{ select: [day: string] }>();

const CELL = 12;
const GAP = 2;
const STEP = CELL + GAP;

const max = computed(() => Math.max(0, ...props.days.map((day) => day.tokens)));
const leading = computed(() => {
  const first = props.days[0];
  if (!first) return 0;
  const [year, month, date] = first.day.split("-").map(Number);
  const weekday = new Date(year!, month! - 1, date!).getDay();
  return (weekday + 6) % 7;
});
const cells = computed(() => {
  if (!props.days.length) return [];
  const list: (UsageHeatDay | null)[] = [...Array<null>(leading.value).fill(null), ...props.days];
  while (list.length % 7) list.push(null);
  return list;
});
const columns = computed(() => Math.max(1, Math.ceil(cells.value.length / 7)));
const width = computed(() => Math.max(0, columns.value * STEP - GAP));

/** Month labels sit at the week where the month starts; one-week months get no label. */
const months = computed(() => {
  const groups: { label: string; start: number; end: number }[] = [];
  props.days.forEach((day, index) => {
    const column = Math.floor((leading.value + index) / 7);
    const label = formatMonthShort(day.day);
    const last = groups.at(-1);
    if (last && last.label === label) last.end = column;
    else groups.push({ label, start: column, end: column });
  });
  return groups
    .filter((group) => group.end - group.start >= 1)
    .map((group) => ({ ...group, left: group.start * STEP }));
});

/** A log scale keeps a single huge day from flattening the rest of the year. */
function levelOf(tokens: number): number {
  if (tokens <= 0) return 0;
  const top = Math.log1p(max.value);
  if (!top) return 1;
  const ratio = Math.log1p(tokens) / top;
  if (ratio >= 0.82) return 4;
  if (ratio >= 0.6) return 3;
  if (ratio >= 0.35) return 2;
  return 1;
}

function titleOf(day: UsageHeatDay): string {
  const answers = countRu(day.answers, "ответ", "ответа", "ответов");
  return `${formatDayLong(day.day)} · ${formatTokens(day.tokens)} токенов · ${answers}`;
}
</script>

<template>
  <div class="heatmap" :style="{ '--cell': `${CELL}px`, '--gap': `${GAP}px` }">
    <div class="scroll">
      <div class="calendar">
        <div class="months" :style="{ width: `${width}px` }">
          <span
            v-for="month in months"
            :key="`${month.label}-${month.start}`"
            :style="{ left: `${month.left}px` }"
            >{{ month.label }}</span
          >
        </div>
        <div class="weekdays" aria-hidden="true">
          <span>Пн</span><span /><span>Ср</span><span /><span>Пт</span><span /><span />
        </div>
        <div class="weeks">
          <template v-for="(cell, index) in cells" :key="cell?.day ?? `blank-${index}`">
            <span v-if="!cell" class="cell blank" />
            <button
              v-else
              type="button"
              class="cell"
              :class="[`level-${levelOf(cell.tokens)}`, { selected: cell.day === selected }]"
              :title="titleOf(cell)"
              :aria-label="titleOf(cell)"
              :aria-pressed="cell.day === selected"
              @click="emit('select', cell.day)"
            />
          </template>
        </div>
      </div>
    </div>
    <div class="legend" aria-hidden="true">
      <span>меньше</span>
      <i v-for="level in 5" :key="level" :class="`level-${level - 1}`" />
      <span>больше</span>
    </div>
  </div>
</template>

<style scoped>
.heatmap {
  display: grid;
  gap: var(--sp-2);
  min-width: 0;
}
.scroll {
  overflow-x: auto;
  padding-bottom: 2px;
}
.calendar {
  display: grid;
  grid-template-columns: auto auto;
  grid-template-areas: ". months" "weekdays weeks";
  align-items: end;
  gap: var(--sp-1) var(--sp-1);
  width: max-content;
}
.months {
  position: relative;
  grid-area: months;
  height: 14px;
}
.months span {
  position: absolute;
  top: 0;
  color: var(--muted);
  font-size: var(--fs-2xs);
  line-height: 1;
  white-space: nowrap;
}
.weekdays {
  display: grid;
  grid-area: weekdays;
  grid-template-rows: repeat(7, var(--cell));
  gap: var(--gap);
  color: var(--muted);
  font-size: var(--fs-2xs);
  line-height: var(--cell);
}
.weeks {
  display: grid;
  grid-area: weeks;
  grid-auto-flow: column;
  grid-template-rows: repeat(7, var(--cell));
  grid-auto-columns: var(--cell);
  gap: var(--gap);
}
.cell {
  width: var(--cell);
  height: var(--cell);
  margin: 0;
  padding: 0;
  border: 0;
  border-radius: 2px;
  background: var(--bg-3);
  box-shadow: inset 0 0 0 1px var(--line);
}
button.cell {
  cursor: pointer;
}
button.cell:hover {
  box-shadow: inset 0 0 0 1px var(--line-strong);
}
button.cell:focus-visible {
  outline: 1px solid var(--focus);
  outline-offset: 1px;
}
.level-1 {
  background: color-mix(in srgb, var(--run) 24%, var(--bg-3));
}
.level-2 {
  background: color-mix(in srgb, var(--run) 45%, var(--bg-3));
}
.level-3 {
  background: color-mix(in srgb, var(--run) 68%, var(--bg-3));
}
.level-4 {
  background: color-mix(in srgb, var(--run) 92%, var(--bg-3));
}
.selected {
  outline: 1px solid var(--focus);
  outline-offset: 1px;
}
.legend {
  display: inline-flex;
  align-items: center;
  gap: var(--sp-1);
  color: var(--muted);
  font-size: var(--fs-2xs);
}
.legend i {
  width: var(--cell);
  height: var(--cell);
  border-radius: 2px;
  box-shadow: inset 0 0 0 1px var(--line);
}
</style>
