import { computed, shallowRef } from "vue";
import { resetCountdown, resetTimestamp } from "../../../common/utilities/reset-time.ts";
import { usagePaceTone, type UsagePaceTone } from "./usage-pace.ts";

export interface UsageWindowData {
  usedPercent: number;
  resetsAt?: number | null;
  limited?: boolean;
}
export interface UsageWindowDefinition<Name extends string = string> {
  name: Name;
  label: string;
  shortLabel: string;
  periodSeconds: number;
  ticks: readonly number[];
}
export interface UsageWindowView {
  name: string;
  label: string;
  remaining: number;
  countdown: string;
  limited: boolean;
  ticks: readonly number[];
  tone: UsagePaceTone | null;
}

export function usageWindowView(
  definition: UsageWindowDefinition,
  data: UsageWindowData,
  now: number,
): UsageWindowView {
  return {
    name: definition.name,
    label: definition.shortLabel,
    remaining: Math.round(100 - data.usedPercent),
    countdown: resetCountdown(data.resetsAt, now),
    limited: data.limited ?? false,
    ticks: definition.ticks,
    tone: usagePaceTone(
      data.usedPercent,
      data.resetsAt,
      definition.periodSeconds,
      now,
      data.limited,
    ),
  };
}

/** Окна приходят от адаптера; модель не знает провайдера, API и IDE-команд. */
export function useUsageWindows<Name extends string>(options: {
  title: string;
  definitions: readonly UsageWindowDefinition<Name>[];
  cycleOrder: readonly Name[];
  initial: Name;
  usage: () => { status: string; message?: string | null } | null;
  windows: () => Partial<Record<Name, UsageWindowData | null>> | null | undefined;
  failed: () => boolean;
  now: () => number;
}) {
  const selectedWindow = shallowRef<Name>(options.initial);
  const selected = computed(() =>
    options.definitions.find((item) => item.name === selectedWindow.value)!,
  );
  const windows = computed(() =>
    !options.failed() && options.usage()?.status === "ready" ? options.windows() : undefined,
  );
  const tooltipRows = computed(() =>
    options.definitions.flatMap((definition) => {
      const data = windows.value?.[definition.name];
      return data ? [usageWindowView(definition, data, options.now())] : [];
    }),
  );
  const current = computed(() =>
    tooltipRows.value.find((row) => row.name === selectedWindow.value),
  );
  const remaining = computed(() => current.value?.remaining ?? null);
  const tone = computed(() => current.value?.tone ?? null);
  const tooltip = computed(() => {
    const heading = `${options.title} · ${selected.value.label}`;
    if (options.failed()) return `${heading}\nНе удалось обновить лимиты`;
    const usage = options.usage();
    if (!usage) return `${heading}\nЗагрузка лимитов…`;
    if (!windows.value) return `${heading}\n${usage.message ?? "Лимиты недоступны"}`;
    return [
      `${heading} · остаток`,
      ...options.definitions.map((definition) => {
        const data = windows.value?.[definition.name];
        if (!data) return `${definition.label}: —`;
        const row = usageWindowView(definition, data, options.now());
        return `${definition.label}: ${row.remaining}%${row.limited ? " · исчерпан" : ""} · ${row.countdown} (${resetTimestamp(data.resetsAt)})`;
      }),
      "Клик — сменить лимит",
    ].join("\n");
  });
  function cycle() {
    selectedWindow.value =
      options.cycleOrder[
        (options.cycleOrder.indexOf(selectedWindow.value) + 1) % options.cycleOrder.length
      ]!;
    return { window: selectedWindow.value };
  }
  return { selectedWindow, selected, remaining, tone, tooltipRows, tooltip, cycle };
}
