<script setup lang="ts">
import { computed } from "vue";
import UiButton from "../../../common/ui/UiButton.vue";
import UiCard from "../../../common/ui/UiCard.vue";
import UiEmpty from "../../../common/ui/UiEmpty.vue";
import UiInline from "../../../common/ui/UiInline.vue";
import UiMessage from "../../../common/ui/UiMessage.vue";
import UiStack from "../../../common/ui/UiStack.vue";
import { countRu } from "../../../common/utilities/plural.ts";
import { useUsageAnalytics } from "../model/analytics.ts";
import { formatCost, formatMoney, formatPercent, formatRange } from "../model/format.ts";
import LimitCard from "./LimitCard.vue";
import ProviderBalanceCard from "./ProviderBalanceCard.vue";
import UsageBarChart from "./UsageBarChart.vue";
import UsageBreakdown from "./UsageBreakdown.vue";
import UsageDonut from "./UsageDonut.vue";
import UsageLine from "./UsageLine.vue";

const {
  ranges,
  days,
  data,
  loading,
  probing,
  error,
  now,
  commands,
  totals,
  dailyPoints,
  costPoints,
  agentRows,
  modelRows,
  projectRows,
  taskItems,
  taskTotalTokens,
  taskTotalCost,
  taskPriced,
  taskMode,
  service,
  serviceCalls,
  limitCards,
  providerRows,
  primaryProvider,
  today,
  todayLabel,
  averageTokens,
  cacheShare,
  priced,
  rangeLabel,
  formatTokens: tokens,
} = useUsageAnalytics();

const tokenSeries = [
  { key: "cacheRead", label: "Из кэша", color: "var(--info)" },
  { key: "input", label: "Без кэша", color: "var(--run)" },
  { key: "cacheWrite", label: "Запись в кэш", color: "var(--warn)" },
  { key: "output", label: "Ответ", color: "var(--err)" },
];

const stats = computed(() => {
  const value = totals.value;
  if (!value) return [];
  return [
    {
      label: "Токены",
      value: tokens(value.tokens),
      hint: countRu(value.answers, "ответ", "ответа", "ответов"),
    },
    {
      label: "Сегодня",
      value: todayLabel.value,
      hint: countRu(today.value?.answers ?? 0, "ответ", "ответа", "ответов"),
    },
    { label: "В среднем в день", value: tokens(averageTokens.value), hint: rangeLabel.value },
    {
      label: "Из кэша",
      value: formatPercent(cacheShare.value * 100),
      hint: `${tokens(value.cacheRead)} токенов`,
    },
    {
      label: "Стоимость Projector",
      value: priced.value ? formatCost(value.cost) : "—",
      hint: priced.value
        ? `${countRu(value.pricedAnswers, "ответ", "ответа", "ответов")} с ценой`
        : primaryProvider.value
          ? "цена не задана · ниже баланс"
          : "цена моделей не задана",
    },
    ...(primaryProvider.value
      ? [
          {
            label: `${primaryProvider.value.label} · расход`,
            value: formatMoney(primaryProvider.value.spent, primaryProvider.value.currency),
            hint:
              primaryProvider.value.total === null
                ? "баланс неизвестен"
                : `остаток ${formatMoney(primaryProvider.value.total, primaryProvider.value.currency)}`,
          },
        ]
      : []),
    ...(serviceCalls.value > 0
      ? [
          {
            label: "Служебные вызовы",
            value: tokens(service.value?.tokens ?? 0),
            hint: `${countRu(serviceCalls.value, "вызов", "вызова", "вызовов")} · Lens, Судья, Доктор`,
          },
        ]
      : []),
  ];
});
</script>

<template>
  <UiStack
    as="section"
    :gap="4"
    @focusin="commands.scope.activate()"
    @pointerdown="commands.scope.activate()"
  >
    <UiInline :gap="2" justify="between" wrap>
      <UiInline :gap="1" wrap aria-label="Период аналитики">
        <UiButton
          v-for="range in ranges"
          :key="range"
          size="sm"
          :active="days === range"
          @click="commands.run('ide.analytics.range.set', { days: range })"
          >{{ formatRange(range) }}</UiButton
        >
      </UiInline>
      <UiButton
        size="sm"
        appearance="outline"
        :busy="loading || probing"
        @click="commands.run('ide.analytics.refresh')"
        >Обновить</UiButton
      >
    </UiInline>

    <UiMessage v-if="error" tone="danger" size="xs">{{ error }}</UiMessage>
    <UiEmpty v-if="!data && loading" density="compact">Считаю расход…</UiEmpty>

    <template v-if="data">
      <div class="stats">
        <UiCard
          v-for="stat in stats"
          :key="stat.label"
          appearance="frame"
          density="compact"
          class="stat"
        >
          <span class="stat-label">{{ stat.label }}</span>
          <strong>{{ stat.value }}</strong>
          <span class="stat-hint">{{ stat.hint }}</span>
        </UiCard>
      </div>

      <div class="grid">
        <UiCard appearance="frame" class="wide" as="section">
          <header class="card-head">
            <h4>Токены по дням</h4>
            <span>{{ rangeLabel }}</span>
          </header>
          <UsageBarChart
            :points="dailyPoints"
            :series="tokenSeries"
            :format="tokens"
            :height="190"
            aria-label="Токены по дням, разделённые по кэшу"
          />
        </UiCard>

        <UiCard v-if="priced" appearance="frame" class="wide" as="section">
          <header class="card-head">
            <h4>Стоимость по дням</h4>
            <span>в валюте тарифа модели</span>
          </header>
          <UsageLine
            :points="costPoints"
            :format="formatCost"
            :height="170"
            aria-label="Стоимость ответов по дням"
          />
        </UiCard>

        <UiCard v-if="providerRows.length" appearance="frame" class="wide" as="section">
          <header class="card-head">
            <h4>Баланс провайдера</h4>
            <span>расход по деньгам, а не по токенам</span>
          </header>
          <div class="providers">
            <ProviderBalanceCard
              v-for="entry in providerRows"
              :key="`${entry.provider}:${entry.currency}`"
              :entry="entry"
            />
          </div>
        </UiCard>

        <UiCard appearance="frame" class="wide" as="section">
          <header class="card-head">
            <h4>Куда ушли деньги</h4>
            <UiInline :gap="1" wrap>
              <span v-if="taskPriced" class="task-total">{{
                taskMode === "cost" ? formatCost(taskTotalCost) : tokens(taskTotalTokens)
              }}</span>
              <UiButton
                v-if="taskPriced"
                size="sm"
                :active="taskMode === 'tokens'"
                @click="commands.run('ide.analytics.tasks.mode.set', { mode: 'tokens' })"
                >Токены</UiButton
              >
              <UiButton
                v-if="taskPriced"
                size="sm"
                :active="taskMode === 'cost'"
                @click="commands.run('ide.analytics.tasks.mode.set', { mode: 'cost' })"
                >Деньги</UiButton
              >
            </UiInline>
          </header>
          <UsageBreakdown
            v-if="taskItems.length"
            :items="taskItems"
            :format="taskMode === 'cost' ? formatCost : tokens"
            aria-label="Распределение расхода по задачам"
          />
          <UiEmpty v-else density="compact" align="start">Нет данных за период</UiEmpty>
          <p class="task-note">
            {{
              taskPriced
                ? "Доля стоимости по задачам: ответы чата и короткие вызовы Projector."
                : "Цена моделей не задана — показана доля токенов; суммы появятся после настройки цен. Lens, Судья и Доктор добавляются после первого вызова."
            }}
          </p>
        </UiCard>

        <UiCard appearance="frame" as="section">
          <header class="card-head">
            <h4>Агенты</h4>
            <span>{{ countRu(totals?.answers ?? 0, "ответ", "ответа", "ответов") }}</span>
          </header>
          <UsageDonut
            v-if="agentRows.length"
            :items="agentRows"
            :center="tokens(totals?.tokens ?? 0)"
            :format="tokens"
          />
          <UiEmpty v-else density="compact" align="start">Нет данных за период</UiEmpty>
        </UiCard>

        <UiCard appearance="frame" as="section">
          <header class="card-head">
            <h4>Модели</h4>
            <span>доля токенов</span>
          </header>
          <UsageBreakdown
            v-if="modelRows.length"
            :items="modelRows"
            :format="tokens"
            aria-label="Токены по моделям"
          />
          <UiEmpty v-else density="compact" align="start">Нет данных за период</UiEmpty>
        </UiCard>

        <UiCard appearance="frame" as="section">
          <header class="card-head">
            <h4>Проекты</h4>
            <span>доля токенов</span>
          </header>
          <UsageBreakdown
            v-if="projectRows.length"
            :items="projectRows"
            :format="tokens"
            aria-label="Токены по проектам"
          />
          <UiEmpty v-else density="compact" align="start">Нет данных за период</UiEmpty>
        </UiCard>
      </div>

      <UiCard appearance="frame" as="section">
        <header class="card-head">
          <h4>Лимиты подписок</h4>
          <span>остаток и темп расхода окна</span>
        </header>
        <div v-if="limitCards.length" class="limits">
          <LimitCard
            v-for="card in limitCards"
            :key="`${card.series.agent}:${card.series.window}`"
            :series="card.series"
            :title="card.title"
            :label="card.label"
            :tone="card.tone"
            :now="now.getTime()"
          />
        </div>
        <UiEmpty v-else density="compact" align="start">
          Лимиты ещё не проверялись. Нажмите «Обновить» — Projector спросит их у настроенных
          агентов.
        </UiEmpty>
        <UiMessage v-if="probing" tone="muted" size="xs"> Запрашиваю лимиты у агентов… </UiMessage>
      </UiCard>

      <UiMessage v-if="!priced" tone="muted" size="xs" variant="note">
        Стоимость Projector по токенам не считается: у моделей не задана цена. Её можно указать в
        разделе «Модели и провайдеры»; фактические деньги видны по балансу провайдера.
      </UiMessage>
    </template>
  </UiStack>
</template>

<style scoped>
.stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: var(--sp-2);
}
.stat {
  display: grid;
  gap: 2px;
  align-content: start;
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
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: var(--sp-3);
}
.wide {
  grid-column: 1 / -1;
}
.card-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--sp-3);
}
.card-head h4 {
  margin: 0;
  color: var(--text);
  font-size: var(--fs-xs);
  font-weight: 600;
}
.card-head span {
  color: var(--muted);
  font-size: var(--fs-2xs);
}
.limits {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: var(--sp-2);
}
.providers {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: var(--sp-4);
}
.task-total {
  color: var(--text-2);
  font-size: var(--fs-2xs);
  font-variant-numeric: tabular-nums;
}
.task-note {
  margin: 0;
  color: var(--muted);
  font-size: var(--fs-2xs);
  line-height: 1.4;
}
</style>
