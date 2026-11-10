import { computed, onMounted, ref, shallowRef, watch } from "vue";
import { useIntervalFn, useNow } from "@vueuse/core";
import {
  ANALYTICS_RANGES,
  usagePaceTone,
  type AnalyticsRange,
  type UsageAnalytics,
} from "@ai-projector/core/modules/usage-analytics/index.ts";
import { clientAgents } from "../../agents-integration/catalog/index.ts";
import { useAgentModes } from "../../agent/index.ts";
import { commandArgs, useCommandScope } from "../../../common/utilities/commands.ts";
import { countRu } from "../../../common/utilities/plural.ts";
import { readUsageAnalytics } from "../api/analytics.ts";
import { isDayKey, useUsageDay } from "./day.ts";
import { formatCost, formatDay, formatRange, formatTokens, windowLabel } from "./format.ts";
import { agentTitle, breakdownRows, taskLabel } from "./rows.ts";

export type { BreakdownRow } from "./rows.ts";

const limitTitle = (window: string) => windowLabel(window);

export function useUsageAnalytics() {
  const days = ref<AnalyticsRange>(30);
  const data = shallowRef<UsageAnalytics | null>(null);
  const loading = ref(false);
  const probing = ref(false);
  const error = ref("");
  let generation = 0;
  const now = useNow({ scheduler: (update) => useIntervalFn(update, 30000) });
  // Disabled agents do not answer limits requests, as in the status bar; wait for the settings.
  const { isEnabled, loaded } = useAgentModes();
  const day = useUsageDay(now);

  async function load(): Promise<void> {
    const current = ++generation;
    loading.value = true;
    try {
      const next = await readUsageAnalytics(days.value);
      if (current === generation) {
        data.value = next;
        error.value = "";
      }
    } catch (issue) {
      if (current === generation)
        error.value = issue instanceof Error ? issue.message : "Не удалось загрузить аналитику";
    } finally {
      if (current === generation) loading.value = false;
    }
  }

  /**
   * Asking each adapter for its limits has a side effect the charts need: the server records the
   * answer. A failing service only leaves its card as it was.
   */
  async function probeLimits(): Promise<void> {
    const urls = [
      ...new Set(clientAgents().flatMap((agent) => (agent.usageUrl ? [agent.usageUrl] : []))),
    ];
    probing.value = true;
    try {
      await Promise.allSettled(
        [...urls, "/api/providers/balance"].map((url) => fetch(url, { cache: "no-store" })),
      );
    } finally {
      probing.value = false;
    }
  }

  async function refresh(): Promise<void> {
    await probeLimits();
    await Promise.all([load(), day.loadDay()]);
  }

  function setDays(range: number): void {
    const next = ANALYTICS_RANGES.find((item) => item === range);
    if (!next || next === days.value) return;
    days.value = next;
    void load();
  }

  onMounted(() => {
    void load();
    void day.loadDay();
    if (loaded.value) void probeLimits().then(load);
  });
  watch(
    loaded,
    (ready) => {
      if (ready) void probeLimits().then(load);
    },
    { once: true },
  );

  const commands = useCommandScope("analytics-settings", () => ({
    surface: "analytics",
    days: days.value,
  }));
  commands.scope.registerCommand({
    id: "ide.analytics.refresh",
    title: "Обновить аналитику расхода",
    description:
      "Заново запрашивает лимиты агентов и перечитывает расход токенов по сохранённым ответам за выбранный период.",
    run: refresh,
  });
  commands.scope.registerCommand({
    id: "ide.analytics.range.set",
    title: "Выбрать период аналитики",
    description: "Переключает графики расхода на 7, 30 или 90 дней.",
    arguments: { days: "7 | 30 | 90" },
    run: (value) => {
      const range = Number(commandArgs(value).days);
      setDays(range);
      return { days: days.value };
    },
  });
  commands.scope.registerCommand({
    id: "ide.analytics.tasks.mode.set",
    title: "Показать распределение по задачам",
    description:
      "Переключает карточку «Куда ушли деньги» между токенами и стоимостью. Стоимость доступна, когда у моделей задана цена.",
    arguments: { mode: "tokens | cost" },
    run: (value) => {
      const mode = commandArgs(value).mode;
      if (mode !== "tokens" && mode !== "cost") throw new Error("Неизвестный режим");
      taskMode.value = mode;
      return { mode: taskMode.value };
    },
  });

  commands.scope.registerCommand({
    id: "ide.analytics.day.set",
    title: "Открыть аналитику дня",
    description:
      "Показывает расход токенов, агентов, модели, проекты и задачи одного локального дня. День задаётся датой YYYY-MM-DD; так же открывается клик по клетке календаря активности.",
    arguments: { day: "YYYY-MM-DD" },
    run: (value) => {
      const raw = commandArgs(value).day;
      const key = typeof raw === "string" ? raw : "";
      if (!isDayKey(key)) throw new Error("День должен быть реальной датой в формате YYYY-MM-DD");
      day.selectDay(key);
      return { day: day.selectedDay.value };
    },
  });
  commands.scope.registerCommand({
    id: "ide.analytics.day.shift",
    title: "Перелистнуть день аналитики",
    description:
      "Переключает карточку дня на предыдущий или следующий день. Вперёд дальше сегодняшнего дня не уходит.",
    arguments: { offset: "-1 | 1 | …" },
    run: (value) => {
      const offset = Number(commandArgs(value).offset);
      if (!Number.isFinite(offset) || !Number.isInteger(offset) || offset === 0)
        throw new Error("Сдвиг дня должен быть целым числом");
      day.shiftDay(offset);
      return { day: day.selectedDay.value };
    },
  });
  commands.scope.registerCommand({
    id: "ide.analytics.day.today",
    title: "Вернуть аналитику на сегодня",
    description: "Открывает карточку дня для текущих локальных суток.",
    run: () => {
      day.selectToday();
      return { day: day.selectedDay.value };
    },
  });

  const totals = computed(() => data.value?.totals);
  const dailyPoints = computed(() =>
    (data.value?.daily ?? []).map((day) => ({
      label: formatDay(day.day),
      values: {
        input: day.input,
        output: day.output,
        cacheRead: day.cacheRead,
        cacheWrite: day.cacheWrite,
      },
    })),
  );
  const costPoints = computed(() =>
    (data.value?.daily ?? []).map((day) => ({ label: formatDay(day.day), value: day.cost })),
  );
  const agentRows = computed(() => {
    const usage = data.value;
    if (!usage) return [];
    return breakdownRows(usage.byAgent, usage.totals.tokens, agentTitle);
  });
  const modelRows = computed(() => {
    const usage = data.value;
    if (!usage) return [];
    return breakdownRows(usage.byModel, usage.totals.tokens, (key) => key);
  });
  const projectRows = computed(() => {
    const usage = data.value;
    if (!usage) return [];
    return breakdownRows(usage.byProject, usage.totals.tokens, (key) => key);
  });
  const heatmapDays = computed(() => data.value?.heatmap ?? []);
  const taskRows = computed(() => {
    const usage = data.value;
    if (!usage) return [];
    const totalTokens = usage.byTask.reduce((sum, item) => sum + item.tokens, 0) || 1;
    const totalCost = usage.byTask.reduce((sum, item) => sum + item.cost, 0) || 1;
    return usage.byTask.map((item) => ({
      key: item.key,
      label: taskLabel(item.key),
      tokens: item.tokens,
      cost: item.cost,
      calls: item.answers,
      shareTokens: item.tokens / totalTokens,
      shareCost: item.cost / totalCost,
    }));
  });
  const taskTotalTokens = computed(() =>
    (data.value?.byTask ?? []).reduce((sum, item) => sum + item.tokens, 0),
  );
  const taskTotalCost = computed(() =>
    (data.value?.byTask ?? []).reduce((sum, item) => sum + item.cost, 0),
  );
  const taskPriced = computed(() => taskTotalCost.value > 0);
  const taskMode = ref<"tokens" | "cost">("tokens");
  watch(taskPriced, (pricedNow) => {
    taskMode.value = pricedNow ? "cost" : "tokens";
  });
  watch(
    () => data.value,
    () => {
      if (taskPriced.value) taskMode.value = "cost";
    },
  );
  const taskItems = computed(() =>
    taskRows.value.map((item) => ({
      label: item.label,
      value: taskMode.value === "cost" ? item.cost : item.tokens,
      share: taskMode.value === "cost" ? item.shareCost : item.shareTokens,
    })),
  );
  const service = computed(() => data.value?.service);
  const serviceCalls = computed(() => data.value?.serviceCalls ?? 0);
  const limitCards = computed(() =>
    (data.value?.limits ?? [])
      .filter((series) => !loaded.value || isEnabled(series.agent))
      .map((series) => ({
        series,
        title: agentTitle(series.agent),
        label: limitTitle(series.window),
        tone: usagePaceTone(
          series.usedPercent ?? 0,
          series.resetsAt,
          series.periodSeconds,
          now.value.getTime(),
          series.limited,
        ),
      }))
      .sort((a, b) => {
        const rank = (tone: typeof a.tone) =>
          tone === "over" ? 0 : tone === "hot" ? 1 : tone === "normal" ? 2 : 3;
        return (
          rank(a.tone) - rank(b.tone) || (b.series.usedPercent ?? 0) - (a.series.usedPercent ?? 0)
        );
      }),
  );
  const today = computed(() => data.value?.daily.at(-1));
  const providerRows = computed(() => data.value?.providers ?? []);
  /** Dollars first: that is the balance people usually mean, and DeepSeek reports USD. */
  const primaryProvider = computed(
    () =>
      providerRows.value.find((item) => item.currency === "USD") ?? providerRows.value[0] ?? null,
  );
  const averageTokens = computed(() =>
    data.value ? data.value.totals.tokens / Math.max(1, data.value.days) : 0,
  );
  const cacheShare = computed(() => {
    const usage = totals.value;
    if (!usage || !usage.tokens) return 0;
    return usage.cacheRead / usage.tokens;
  });
  const priced = computed(() => (totals.value?.pricedAnswers ?? 0) > 0);
  const hasUsage = computed(() => (totals.value?.answers ?? 0) > 0);
  const rangeLabel = computed(() => formatRange(days.value));
  const todayLabel = computed(() => formatTokens(today.value?.tokens ?? 0));
  /** Provenance of the cost total: an agent's own report and Projector's tariff are not the same. */
  const costNote = computed(() => {
    const value = totals.value;
    if (!value) return "";
    const parts: string[] = [];
    if (value.recordedCost > 0) parts.push(`записано агентом ${formatCost(value.recordedCost)}`);
    if (value.computedCost > 0) parts.push(`по тарифу ${formatCost(value.computedCost)}`);
    return parts.join(" · ");
  });
  const sourceRows = computed(() =>
    (data.value?.sources ?? []).map((source) => ({
      ...source,
      statusLabel:
        source.status === "ok"
          ? "читается"
          : source.status === "empty"
            ? "нет событий"
            : source.status === "unavailable"
              ? "не найден"
              : "ошибка",
      note:
        source.status === "error"
          ? (source.message ?? "журнал не прочитан")
          : source.status === "unavailable"
            ? "каталог журналов отсутствует"
            : `${countRu(source.files, "файл", "файла", "файлов")} · ${countRu(source.events, "событие", "события", "событий")}`,
    })),
  );

  return {
    ranges: ANALYTICS_RANGES,
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
    ...day,
    taskRows,
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
    hasUsage,
    rangeLabel,
    costNote,
    sourceRows,
    formatTokens,
    refresh,
    setDays,
  };
}
