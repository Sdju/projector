<script setup lang="ts">
import { computed } from "vue";
import UiButton from "../../../common/ui/UiButton.vue";
import UiCard from "../../../common/ui/UiCard.vue";
import UiEmpty from "../../../common/ui/UiEmpty.vue";
import UiInline from "../../../common/ui/UiInline.vue";
import UiLoader from "../../../common/ui/UiLoader.vue";
import UiMessage from "../../../common/ui/UiMessage.vue";
import UiStack from "../../../common/ui/UiStack.vue";
import UiStat from "../../../common/ui/UiStat.vue";
import { countRu } from "../../../common/utilities/plural.ts";
import { useUsageAnalytics } from "../model/analytics.ts";
import { formatCost, formatMoney, formatPercent, formatRange } from "../model/format.ts";
import { usageTokenSeries } from "../model/rows.ts";
import DayUsageCard from "./DayUsageCard.vue";
import LimitCard from "./LimitCard.vue";
import ProviderBalanceCard from "./ProviderBalanceCard.vue";
import UsageBarChart from "./UsageBarChart.vue";
import UsageBreakdown from "./UsageBreakdown.vue";
import UsageDonut from "./UsageDonut.vue";
import UsageHeatmap from "./UsageHeatmap.vue";
import UsageLine from "./UsageLine.vue";

const {
  section,
  sections,
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
  heatmapDays,
  agentRows,
  modelRows,
  projectRows,
  selectedDay,
  dayData,
  dayLoading,
  dayError,
  dayAgentRows,
  dayModelRows,
  dayProjectRows,
  dayTaskItems,
  dayHourlyPoints,
  dayPriced,
  dayCacheShare,
  dayHasUsage,
  canShiftForward,
  taskItems,
  taskTotalTokens,
  taskTotalCost,
  taskPriced,
  taskMode,
  service,
  serviceCalls,
  limitCards,
  providerRows,
  providerTotals,
  today,
  todayLabel,
  averageTokens,
  cacheShare,
  priced,
  rangeLabel,
  costNote,
  sourceRows,
  formatTokens: tokens,
} = useUsageAnalytics();

const tokenSeries = usageTokenSeries;
const limitGroups = computed(() => {
  const groups = new Map<string, typeof limitCards.value>();
  for (const card of limitCards.value) {
    const group = groups.get(card.series.agent) ?? [];
    group.push(card);
    groups.set(card.series.agent, group);
  }
  return [...groups.entries()]
    .map(([agent, cards]) => ({
      agent,
      title: cards[0]!.title,
      cards: [...cards].sort(
        (a, b) =>
          (a.series.periodSeconds ?? Number.POSITIVE_INFINITY) -
            (b.series.periodSeconds ?? Number.POSITIVE_INFINITY) ||
          a.label.localeCompare(b.label, "ru"),
      ),
    }))
    .sort((a, b) => a.title.localeCompare(b.title, "ru"));
});

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
        ? costNote.value || `${countRu(value.pricedAnswers, "ответ", "ответа", "ответов")} с ценой`
        : providerTotals.value.length
          ? "цена не задана · ниже кошельки"
          : "цена моделей не задана",
    },
    ...providerTotals.value.map((total) => ({
      label: `Кошельки · ${total.currency}`,
      value: total.total === null ? "—" : formatMoney(total.total, total.currency),
      hint:
        total.unknown > 0
          ? `часть балансов неизвестна · потрачено ${formatMoney(total.spent, total.currency)}`
          : `потрачено ${formatMoney(total.spent, total.currency)} · ${countRu(total.wallets, "кошелёк", "кошелька", "кошельков")}`,
    })),
    ...(serviceCalls.value > 0
      ? [
          {
            label: "Служебные вызовы",
            value: tokens(service.value?.tokens ?? 0),
            hint: `${countRu(serviceCalls.value, "вызов", "вызова", "вызовов")} · Lens, Судья, Доктор, Диктовка`,
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
      <UiInline class="selection-buttons" :gap="1" wrap aria-label="Период аналитики">
        <UiButton
          v-for="range in ranges"
          :key="range"
          size="sm"
          :active="days === range"
          :aria-pressed="days === range"
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
    <UiLoader v-if="!data && loading" :padding="3">Считаю расход…</UiLoader>

    <template v-if="data">
      <nav class="section-nav selection-buttons" aria-label="Разделы аналитики">
        <UiButton
          v-for="item in sections"
          :key="item.id"
          size="sm"
          :active="section === item.id"
          :aria-pressed="section === item.id"
          @click="commands.run('ide.analytics.section.set', { section: item.id })"
          >{{ item.label }}</UiButton
        >
      </nav>
      <div v-show="section === 'overview'" class="section-content">
        <div class="stats">
          <UiCard v-for="stat in stats" :key="stat.label" appearance="frame" density="compact">
            <UiStat :label="stat.label" :value="stat.value" :hint="stat.hint" />
          </UiCard>
        </div>

        <UiCard appearance="frame" as="section">
          <header class="card-head">
            <h4>Лимиты подписок</h4>
            <span>остаток и темп расхода окна</span>
          </header>
          <div v-if="limitGroups.length" class="limit-groups">
            <section v-for="group in limitGroups" :key="group.agent" class="limit-group">
              <h5>{{ group.title }}</h5>
              <div class="limits">
                <LimitCard
                  v-for="card in group.cards"
                  :key="card.series.window"
                  :series="card.series"
                  :title="card.title"
                  :label="card.label"
                  :tone="card.tone"
                  :now="now.getTime()"
                />
              </div>
            </section>
          </div>
          <UiEmpty v-else density="compact" align="start">
            Лимиты ещё не проверялись. Нажмите «Обновить» — Projector спросит их у настроенных
            агентов.
          </UiEmpty>
          <UiLoader v-if="probing" size="sm">Запрашиваю лимиты у агентов…</UiLoader>
        </UiCard>
      </div>
      <div v-show="section === 'activity'" class="grid">
        <UiCard appearance="frame" class="wide" as="section">
          <header class="card-head">
            <h4>Активность за год</h4>
            <span>токены по дням · последний год</span>
          </header>
          <UsageHeatmap
            :days="heatmapDays"
            :selected="selectedDay"
            @select="commands.run('ide.analytics.day.set', { day: $event })"
          />
        </UiCard>

        <UiCard appearance="frame" class="wide" as="section">
          <header class="card-head">
            <h4>Токены по дням</h4>
            <span>{{ rangeLabel }} · выберите столбец для подробностей дня</span>
          </header>
          <UsageBarChart
            :points="dailyPoints"
            :series="tokenSeries"
            :format="tokens"
            :height="190"
            selectable
            @select="commands.run('ide.analytics.day.set', { day: $event })"
            aria-label="Токены по дням, разделённые по кэшу"
          />
        </UiCard>

        <DayUsageCard
          class="wide"
          :day="selectedDay"
          :data="dayData"
          :loading="dayLoading"
          :error="dayError"
          :agent-rows="dayAgentRows"
          :model-rows="dayModelRows"
          :project-rows="dayProjectRows"
          :task-items="dayTaskItems"
          :hourly-points="dayHourlyPoints"
          :priced="dayPriced"
          :cache-share="dayCacheShare"
          :has-usage="dayHasUsage"
          :can-forward="canShiftForward"
          @shift="commands.run('ide.analytics.day.shift', { offset: $event })"
          @today="commands.run('ide.analytics.day.today')"
        />

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
      </div>
      <div v-show="section === 'breakdown'" class="grid">
        <UiCard appearance="frame" class="wide" as="section">
          <header class="card-head">
            <h4>Куда ушли деньги</h4>
            <UiInline class="selection-buttons" :gap="1" wrap>
              <span v-if="taskPriced" class="task-total">{{
                taskMode === "cost" ? formatCost(taskTotalCost) : tokens(taskTotalTokens)
              }}</span>
              <UiButton
                v-if="taskPriced"
                size="sm"
                :active="taskMode === 'tokens'"
                :aria-pressed="taskMode === 'tokens'"
                @click="commands.run('ide.analytics.tasks.mode.set', { mode: 'tokens' })"
                >Токены</UiButton
              >
              <UiButton
                v-if="taskPriced"
                size="sm"
                :active="taskMode === 'cost'"
                :aria-pressed="taskMode === 'cost'"
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
                ? "Доля стоимости по задачам: ответы чата и короткие вызовы Projector, включая диктовку по тарифу модели."
                : "Цена моделей не задана — показана доля токенов; суммы появятся после настройки цен. Lens, Судья, Доктор и диктовка добавляются после первого вызова."
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
      <div v-show="section === 'finance'" class="section-content">
        <UiCard v-if="providerRows.length" appearance="frame" class="wide" as="section">
          <header class="card-head">
            <h4>Кошельки</h4>
            <span>общий остаток и каждый провайдер отдельно</span>
          </header>
          <div class="wallet-totals">
            <div v-for="total in providerTotals" :key="total.currency" class="wallet-total">
              <span class="wallet-caption">все кошельки · {{ total.currency }}</span>
              <strong>{{
                total.total === null ? "—" : formatMoney(total.total, total.currency)
              }}</strong>
              <span class="wallet-note"
                >потрачено {{ formatMoney(total.spent, total.currency) }} ·
                {{ countRu(total.wallets, "кошелёк", "кошелька", "кошельков")
                }}<template v-if="total.unknown"> · {{ total.unknown }} без баланса</template></span
              >
            </div>
          </div>
          <div class="providers">
            <ProviderBalanceCard
              v-for="entry in providerRows"
              :key="`${entry.provider}:${entry.currency}`"
              :entry="entry"
            />
          </div>
        </UiCard>
      </div>
      <div v-show="section === 'sources'" class="section-content">
        <UiCard v-if="sourceRows.length" appearance="frame" as="section">
          <header class="card-head">
            <h4>Источники журналов</h4>
            <span>нативные логи агентов</span>
          </header>
          <div class="sources">
            <div
              v-for="source in sourceRows"
              :key="source.agent"
              class="source"
              :class="`source-${source.status}`"
            >
              <UiInline :gap="2" justify="between" wrap>
                <strong>{{ source.label }}</strong>
                <span class="source-status">{{ source.statusLabel }}</span>
              </UiInline>
              <span class="source-note">{{ source.note }}</span>
            </div>
          </div>
          <p class="task-note">
            Codex, OpenCode, Kimi и Cursor читаются из своих журналов, поэтому в расход попадают и
            запуски в терминале. Ошибка чтения показана отдельно и не превращается в ноль токенов.
          </p>
        </UiCard>
      </div>

      <UiMessage v-if="!priced && section === 'finance'" tone="muted" size="xs" variant="note">
        Стоимость Projector по токенам не считается: у моделей не задана цена. Её можно указать в
        разделе «Модели и провайдеры»; фактические деньги видны по балансу провайдера.
      </UiMessage>
    </template>
  </UiStack>
</template>

<style scoped>
.selection-buttons :deep(.btn.active) {
  color: var(--text);
  background: var(--active);
  border-color: var(--text-2);
}
.section-nav {
  display: flex;
  gap: var(--sp-1);
  flex-wrap: wrap;
  padding-bottom: var(--sp-2);
  border-bottom: 1px solid var(--line);
}
.section-content {
  display: grid;
  gap: var(--sp-3);
}
.limit-groups {
  display: grid;
  gap: var(--sp-4);
}
.limit-group {
  display: grid;
  gap: var(--sp-2);
}
.limit-group h5 {
  margin: 0;
  color: var(--text-2);
  font-size: var(--fs-xs);
}
.stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: var(--sp-2);
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
.wallet-totals {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sp-4);
  padding-bottom: var(--sp-2);
  border-bottom: 1px solid var(--line);
}
.wallet-total {
  display: grid;
  gap: 2px;
}
.wallet-total strong {
  color: var(--text);
  font-size: 22px;
  font-weight: 600;
  line-height: 1.1;
  font-variant-numeric: tabular-nums;
}
.wallet-caption,
.wallet-note {
  color: var(--muted);
  font-size: var(--fs-2xs);
}
.providers {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: var(--sp-4);
}
.sources {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: var(--sp-2);
}
.source {
  display: grid;
  gap: 2px;
  padding: var(--sp-2);
  border: 1px solid var(--line);
  border-radius: var(--r-sm);
}
.source strong {
  color: var(--text);
  font-size: var(--fs-xs);
  font-weight: 600;
}
.source-status,
.source-note {
  color: var(--muted);
  font-size: var(--fs-2xs);
  line-height: 1.35;
}
.source-error {
  border-color: var(--err);
}
.source-unavailable {
  opacity: 0.75;
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
