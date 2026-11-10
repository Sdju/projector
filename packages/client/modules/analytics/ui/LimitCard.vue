<script setup lang="ts">
import UiMeter from "../../../common/ui/UiMeter.vue";
import { computed } from "vue";
import type {
  LimitSeries,
  UsagePaceTone,
} from "@projector-ai/core/modules/usage-analytics/index.ts";
import { resetCountdown, resetTimestamp } from "../../../common/utilities/reset-time.ts";
import { formatPercent } from "../model/format.ts";

const props = defineProps<{
  series: LimitSeries;
  title: string;
  label: string;
  tone: UsagePaceTone | null;
  now: number;
}>();

const used = computed(() => props.series.usedPercent);
const remaining = computed(() => (used.value === null ? null : Math.max(0, 100 - used.value)));
const countdown = computed(() => resetCountdown(props.series.resetsAt, props.now));
const resetAt = computed(() => resetTimestamp(props.series.resetsAt));
const expected = computed(() => props.series.expectedPercent);
const projected = computed(() => props.series.projectedPercent);
const exhausted = computed(() => props.series.limited || (used.value ?? 0) >= 100);
const meterTone = computed(() => {
  if (props.tone === "spare") return "info" as const;
  if (props.tone === "hot") return "warning" as const;
  if (props.tone === "over") return "danger" as const;
  return "neutral" as const;
});

const pace = computed(() => {
  if (exhausted.value) return { text: "Лимит исчерпан", hint: "" };
  if (expected.value === null)
    return { text: "Темп без оценки", hint: "окно не сообщает длину цикла" };
  const delta = (used.value ?? 0) - expected.value;
  if (delta <= -15)
    return { text: "Ниже темпа", hint: `по времени ожидалось ${formatPercent(expected.value)}` };
  if (delta <= 8)
    return {
      text: "В пределах темпа",
      hint: `по времени ожидалось ${formatPercent(expected.value)}`,
    };
  if (delta <= 22)
    return { text: "Выше темпа", hint: `по времени ожидалось ${formatPercent(expected.value)}` };
  return { text: "Быстрее окна", hint: `по времени ожидалось ${formatPercent(expected.value)}` };
});

/** A projection is only worth showing when the recorded pace has something to stand on. */
const projection = computed(() =>
  projected.value === null
    ? ""
    : `к сбросу ≈ ${formatPercent(projected.value)}${projected.value >= 100 ? " · исчерпание" : ""}`,
);

const spark = computed(() => {
  const points = props.series.points;
  if (points.length < 2) return "";
  const first = points[0]!;
  const last = points.at(-1)!;
  const spanX = Math.max(1, last.at - first.at);
  const values = points.map((point) => point.used);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const flat = max - min < 0.5;
  const spanY = Math.max(1, max - min);
  return points
    .map((point) => {
      const x = ((point.at - first.at) / spanX) * 100;
      const y = flat ? 15 : 26 - ((point.used - min) / spanY) * 22;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
});
</script>

<template>
  <article class="limit" :class="tone ? `tone-${tone}` : undefined">
    <header>
      <strong>{{ title }}</strong>
      <span class="window">{{ label }}</span>
    </header>
    <div class="figures">
      <span class="remaining">{{ remaining === null ? "—" : formatPercent(remaining) }}</span>
      <span class="caption">осталось</span>
      <span class="spacer" />
      <span class="countdown" :title="resetAt">сброс через {{ countdown }}</span>
    </div>
    <UiMeter
      :value="used ?? 0"
      :height="6"
      :tone="meterTone"
      :aria-label="`Лимит ${title}, ${label}: израсходовано ${formatPercent(used)}`"
    />
    <div class="meta">
      <span>израсходовано {{ formatPercent(used) }}</span>
      <span>{{ pace.text }}</span>
    </div>
    <p class="hint">
      {{ pace.hint }}<template v-if="projection"> · {{ projection }}</template>
    </p>
    <svg
      v-if="spark"
      class="spark"
      viewBox="0 0 100 30"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <polyline :points="spark" vector-effect="non-scaling-stroke" />
    </svg>
    <p v-else class="hint">история появится после нескольких проверок</p>
  </article>
</template>

<style scoped>
.limit {
  display: grid;
  gap: 5px;
  padding: var(--sp-3);
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  background: var(--bg-2);
  color: var(--muted);
}
.tone-spare {
  border-color: color-mix(in srgb, var(--info) 50%, var(--line));
}
.tone-hot {
  border-color: color-mix(in srgb, var(--warn) 55%, var(--line));
}
.tone-over {
  border-color: color-mix(in srgb, var(--err) 55%, var(--line));
}
header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--sp-2);
}
header strong {
  color: var(--text);
  font-size: var(--fs-xs);
  font-weight: 600;
}
.window {
  color: var(--muted);
  font-size: var(--fs-2xs);
}
.figures {
  display: flex;
  align-items: baseline;
  gap: 6px;
}
.remaining {
  color: var(--text);
  font-size: 24px;
  font-weight: 600;
  line-height: 1.1;
  font-variant-numeric: tabular-nums;
}
.tone-hot .remaining {
  color: var(--warn);
}
.tone-over .remaining {
  color: var(--err);
}
.caption,
.countdown,
.meta,
.hint {
  font-size: var(--fs-2xs);
}
.spacer {
  flex: 1;
}
.countdown {
  color: var(--text-2);
  font-variant-numeric: tabular-nums;
}
.meta {
  display: flex;
  justify-content: space-between;
  gap: var(--sp-2);
  color: var(--text-2);
  font-variant-numeric: tabular-nums;
}
.hint {
  margin: 0;
  color: var(--muted);
}
.spark {
  display: block;
  width: 100%;
  height: 22px;
  margin-top: 2px;
}
.spark polyline {
  fill: none;
  stroke: currentColor;
  stroke-width: 1.5;
  opacity: 0.8;
}
.tone-spare .spark {
  color: var(--info);
}
.tone-hot .spark {
  color: var(--warn);
}
.tone-over .spark {
  color: var(--err);
}
</style>
