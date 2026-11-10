<script setup lang="ts">
import { computed } from "vue";
import type { UsageDayAnalytics } from "@ai-projector/core/modules/usage-analytics/index.ts";
import UiButton from "../../../common/ui/UiButton.vue";
import UiCard from "../../../common/ui/UiCard.vue";
import UiEmpty from "../../../common/ui/UiEmpty.vue";
import UiInline from "../../../common/ui/UiInline.vue";
import UiLoader from "../../../common/ui/UiLoader.vue";
import UiMessage from "../../../common/ui/UiMessage.vue";
import { countRu } from "../../../common/utilities/plural.ts";
import { usageTokenSeries, type BreakdownRow } from "../model/rows.ts";
import {
  formatCost,
  formatDayKey,
  formatDayLong,
  formatDayWeekday,
  formatPercent,
  formatTokens,
} from "../model/format.ts";
import UsageBarChart from "./UsageBarChart.vue";
import UsageBreakdown from "./UsageBreakdown.vue";
import UsageDonut from "./UsageDonut.vue";

const props = defineProps<{
  day: string;
  data: UsageDayAnalytics | null;
  loading: boolean;
  error: string;
  agentRows: BreakdownRow[];
  modelRows: BreakdownRow[];
  projectRows: BreakdownRow[];
  taskItems: BreakdownRow[];
  hourlyPoints: { label: string; values: Record<string, number> }[];
  priced: boolean;
  cacheShare: number;
  hasUsage: boolean;
  canForward: boolean;
}>();

const emit = defineEmits<{ shift: [offset: number]; today: [] }>();

const isToday = computed(() => props.day === formatDayKey());
const answers = computed(() => props.data?.totals.answers ?? 0);
/** Axis edges, not bar centers: the day ends with `00:00`, so no hour is left out. */
const hourEdges = computed(() =>
  Array.from({ length: props.hourlyPoints.length + 1 }, (_, hour) => {
    const value = hour % 24;
    return `${String(value).padStart(2, "0")}:00`;
  }),
);
</script>

<template>
  <UiCard appearance="frame" as="section" class="day-card">
    <header class="card-head">
      <div class="day-title">
        <h4>День</h4>
        <span>{{ formatDayLong(day) }} · {{ formatDayWeekday(day) }}</span>
      </div>
      <UiInline :gap="1">
        <UiButton shape="icon" size="sm" aria-label="Предыдущий день" @click="emit('shift', -1)"
          >←</UiButton
        >
        <UiButton size="sm" :disabled="isToday" @click="emit('today')">Сегодня</UiButton>
        <UiButton
          shape="icon"
          size="sm"
          aria-label="Следующий день"
          :disabled="!canForward"
          @click="emit('shift', 1)"
          >→</UiButton
        >
      </UiInline>
    </header>

    <UiMessage v-if="error" tone="danger" size="xs">{{ error }}</UiMessage>
    <UiLoader v-if="loading && !data" size="sm">Считаю день…</UiLoader>

    <template v-if="data">
      <div class="day-stats">
        <div class="stat">
          <span class="stat-label">Токены</span>
          <strong>{{ formatTokens(data.totals.tokens) }}</strong>
          <span class="stat-hint">{{ countRu(answers, "ответ", "ответа", "ответов") }}</span>
        </div>
        <div class="stat">
          <span class="stat-label">Из кэша</span>
          <strong>{{ formatPercent(cacheShare * 100) }}</strong>
          <span class="stat-hint">{{ formatTokens(data.totals.cacheRead) }} токенов</span>
        </div>
        <div class="stat">
          <span class="stat-label">Стоимость</span>
          <strong>{{ priced ? formatCost(data.totals.cost) : "—" }}</strong>
          <span class="stat-hint">{{
            !hasUsage
              ? "нет расхода"
              : priced
                ? `${countRu(data.totals.pricedAnswers, "ответ", "ответа", "ответов")} с ценой`
                : "цена моделей не задана"
          }}</span>
        </div>
        <div v-if="data.serviceCalls" class="stat">
          <span class="stat-label">Служебные вызовы</span>
          <strong>{{ data.serviceCalls }}</strong>
          <span class="stat-hint">Lens, Судья, Доктор</span>
        </div>
      </div>

      <UiEmpty v-if="!hasUsage" density="compact" align="start">
        В этот день ответов и событий журналов нет.
      </UiEmpty>

      <template v-else>
        <section class="day-chart">
          <header class="cell-head">
            <h5>Токены по часам</h5>
            <span>ответы и журналы · местное время</span>
          </header>
          <UsageBarChart
            :points="hourlyPoints"
            :series="usageTokenSeries"
            :axis-edges="hourEdges"
            :format="formatTokens"
            :height="170"
            aria-label="Токены по часам за день"
          />
        </section>

        <div class="day-grid">
          <section class="day-cell">
            <header class="cell-head">
              <h5>Агенты</h5>
              <span>доля токенов</span>
            </header>
            <UsageDonut
              v-if="agentRows.length"
              :items="agentRows"
              :center="formatTokens(data.totals.tokens)"
              :format="formatTokens"
            />
            <UiEmpty v-else density="compact" align="start">Нет данных</UiEmpty>
          </section>
          <section class="day-cell">
            <header class="cell-head">
              <h5>Модели</h5>
              <span>доля токенов</span>
            </header>
            <UsageBreakdown
              v-if="modelRows.length"
              :items="modelRows"
              :format="formatTokens"
              aria-label="Токены по моделям за день"
            />
            <UiEmpty v-else density="compact" align="start">Нет данных</UiEmpty>
          </section>
          <section class="day-cell">
            <header class="cell-head">
              <h5>Проекты</h5>
              <span>доля токенов</span>
            </header>
            <UsageBreakdown
              v-if="projectRows.length"
              :items="projectRows"
              :format="formatTokens"
              aria-label="Токены по проектам за день"
            />
            <UiEmpty v-else density="compact" align="start">Нет данных</UiEmpty>
          </section>
          <section class="day-cell">
            <header class="cell-head">
              <h5>Задачи</h5>
              <span>доля токенов</span>
            </header>
            <UsageBreakdown
              v-if="taskItems.length"
              :items="taskItems"
              :format="formatTokens"
              aria-label="Токены по задачам за день"
            />
            <UiEmpty v-else density="compact" align="start">Нет данных</UiEmpty>
          </section>
        </div>
      </template>
    </template>
  </UiCard>
</template>

<style scoped>
.day-card {
  display: grid;
  gap: var(--sp-3);
}
.card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-3);
  flex-wrap: wrap;
}
.day-title {
  display: flex;
  align-items: baseline;
  gap: var(--sp-2);
  flex-wrap: wrap;
}
.day-title h4 {
  margin: 0;
  color: var(--text);
  font-size: var(--fs-xs);
  font-weight: 600;
}
.day-title span {
  color: var(--muted);
  font-size: var(--fs-2xs);
}
.day-stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: var(--sp-2);
}
.stat {
  display: grid;
  gap: 3px;
  align-content: start;
  padding: var(--sp-2) var(--sp-3);
  border: 1px solid var(--line);
  border-radius: var(--r-sm);
}
.stat-label,
.stat-hint {
  color: var(--muted);
  font-size: var(--fs-2xs);
}
.stat strong {
  color: var(--text);
  font-size: var(--fs-md);
  font-weight: 600;
  line-height: 1.2;
  font-variant-numeric: tabular-nums;
}
.day-chart,
.day-cell {
  display: grid;
  gap: var(--sp-2);
  align-content: start;
  min-width: 0;
}
.day-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
  align-items: start;
  gap: var(--sp-3);
}
.cell-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--sp-2);
}
.cell-head h5 {
  margin: 0;
  color: var(--text);
  font-size: var(--fs-2xs);
  font-weight: 600;
}
.cell-head span {
  color: var(--muted);
  font-size: var(--fs-2xs);
}
</style>
