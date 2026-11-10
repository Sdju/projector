import { computed, ref, shallowRef, type Ref } from "vue";
import type { UsageDayAnalytics } from "@ai-projector/core/modules/usage-analytics/index.ts";
import { readDayUsage } from "../api/analytics.ts";
import { formatDayKey, shiftDayKey } from "./format.ts";
import { agentTitle, breakdownRows, taskLabel } from "./rows.ts";

/** A real local calendar day in `YYYY-MM-DD`; `2026-02-31` must not select March. */
export function isDayKey(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && shiftDayKey(value, 0) === value;
}

/** One day opened from the heatmap or the arrows; the range charts do not change. */
export function useUsageDay(now: Ref<Date>) {
  const selectedDay = ref(formatDayKey());
  const dayData = shallowRef<UsageDayAnalytics | null>(null);
  const dayLoading = ref(false);
  const dayError = ref("");
  let generation = 0;

  async function loadDay(day = selectedDay.value): Promise<void> {
    const current = ++generation;
    dayLoading.value = true;
    try {
      const next = await readDayUsage(day);
      if (current === generation) {
        dayData.value = next;
        dayError.value = "";
      }
    } catch (issue) {
      if (current === generation) {
        dayData.value = null;
        dayError.value =
          issue instanceof Error ? issue.message : "Не удалось загрузить аналитику дня";
      }
    } finally {
      if (current === generation) dayLoading.value = false;
    }
  }

  function selectDay(day: string): void {
    if (!isDayKey(day)) return;
    if (day === selectedDay.value && dayData.value) return;
    selectedDay.value = day;
    dayData.value = null;
    dayError.value = "";
    void loadDay(day);
  }

  function shiftDay(offset: number): void {
    if (!Number.isFinite(offset) || !Number.isInteger(offset)) return;
    const next = shiftDayKey(selectedDay.value, offset);
    if (!isDayKey(next) || next > formatDayKey()) return;
    selectDay(next);
  }

  function selectToday(): void {
    selectDay(formatDayKey());
  }

  const dayAgentRows = computed(() => {
    const day = dayData.value;
    if (!day) return [];
    return breakdownRows(day.byAgent, day.totals.tokens, agentTitle);
  });
  const dayModelRows = computed(() => {
    const day = dayData.value;
    if (!day) return [];
    return breakdownRows(day.byModel, day.totals.tokens, (key) => key);
  });
  const dayProjectRows = computed(() => {
    const day = dayData.value;
    if (!day) return [];
    return breakdownRows(day.byProject, day.totals.tokens, (key) => key);
  });
  const dayTaskItems = computed(() => {
    const day = dayData.value;
    if (!day) return [];
    const total = day.byTask.reduce((sum, item) => sum + item.tokens, 0) || 1;
    return day.byTask.map((item) => ({
      label: taskLabel(item.key),
      value: item.tokens,
      share: item.tokens / total,
    }));
  });
  const dayHourlyPoints = computed(() =>
    (dayData.value?.hourly ?? []).map((hour) => ({
      label: `${String(hour.hour).padStart(2, "0")}:00`,
      values: {
        input: hour.input,
        output: hour.output,
        cacheRead: hour.cacheRead,
        cacheWrite: hour.cacheWrite,
      },
    })),
  );
  const dayPriced = computed(() => (dayData.value?.totals.pricedAnswers ?? 0) > 0);
  const dayCacheShare = computed(() => {
    const totals = dayData.value?.totals;
    if (!totals || !totals.tokens) return 0;
    return totals.cacheRead / totals.tokens;
  });
  const dayHasUsage = computed(() => (dayData.value?.totals.answers ?? 0) > 0);
  const canShiftForward = computed(() => selectedDay.value < formatDayKey(now.value));

  return {
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
    loadDay,
    selectDay,
    shiftDay,
    selectToday,
  };
}
