<script setup lang="ts">
import { computed } from "vue";
import type { ProviderSpend } from "@ai-projector/core/modules/usage-analytics/index.ts";
import { formatDayAt, formatMoney, formatTimeAt } from "../model/format.ts";
import UsageLine from "./UsageLine.vue";

const props = defineProps<{ entry: ProviderSpend }>();

/** A day of balance points reads better as dates; a few hours of them — as times. */
const span = computed(() => {
  const first = props.entry.points[0]?.at ?? 0;
  const last = props.entry.points.at(-1)?.at ?? 0;
  return last - first;
});
const label = (at: number) => (span.value < 36 * 3600000 ? formatTimeAt(at) : formatDayAt(at));
const points = computed(() =>
  props.entry.points.map((point) => ({
    label: label(point.at),
    value: point.total,
  })),
);
const money = (value: number) => formatMoney(value, props.entry.currency);
const checked = computed(() => {
  const at = props.entry.checkedAt;
  if (!at) return "баланс ещё не проверялся";
  return `последняя проверка ${formatDayAt(at)}`;
});
</script>

<template>
  <article class="provider">
    <header>
      <strong>{{ entry.label }}</strong>
      <span class="currency">{{ entry.currency }}</span>
    </header>
    <div class="figures">
      <span class="balance">{{ entry.total === null ? "—" : money(entry.total) }}</span>
      <span class="caption">остаток</span>
    </div>
    <div class="movement">
      <span>Потрачено за период</span>
      <strong>{{ money(entry.spent) }}</strong>
    </div>
    <div v-if="entry.toppedUp > 0" class="movement topped">
      <span>Пополнено</span>
      <strong>{{ money(entry.toppedUp) }}</strong>
    </div>
    <UsageLine
      v-if="points.length > 1"
      :points="points"
      :format="money"
      :height="132"
      color="var(--run)"
      :aria-label="`Баланс ${entry.label} в ${entry.currency}`"
    />
    <p v-else class="hint">История появится после нескольких проверок баланса.</p>
    <p class="hint">{{ checked }} · обновляется со статусной строкой и кнопкой «Обновить».</p>
  </article>
</template>

<style scoped>
.provider {
  display: grid;
  gap: 6px;
  min-width: 0;
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
.currency {
  color: var(--muted);
  font-size: var(--fs-2xs);
  font-variant-numeric: tabular-nums;
}
.figures {
  display: flex;
  align-items: baseline;
  gap: 6px;
}
.balance {
  color: var(--text);
  font-size: 24px;
  font-weight: 600;
  line-height: 1.1;
  font-variant-numeric: tabular-nums;
}
.caption,
.hint {
  color: var(--muted);
  font-size: var(--fs-2xs);
}
.movement {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--sp-2);
  color: var(--muted);
  font-size: var(--fs-2xs);
}
.movement strong {
  color: var(--text-2);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.topped strong {
  color: var(--info);
}
.hint {
  margin: 0;
}
</style>
