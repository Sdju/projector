import { onMounted, ref, shallowRef, useId } from "vue";
import { useIntervalFn, useNow } from "@vueuse/core";
import type {
  AntigravityUsage,
  AntigravityUsageWindowName,
} from "@ai-projector/core/modules/agents-integration/antigravity/index.ts";
import { useCommandScope } from "../../../../common/utilities/commands.ts";
import { publishAgentUsage } from "../../_/usage-summary.ts";
import { USAGE_PERIOD_SECONDS } from "../../_/usage-pace.ts";
import { useUsageWindows } from "../../_/usage-windows.ts";
import { readCachedAntigravityUsage, refreshAntigravityUsageApi } from "../api/usage.ts";

const weekTicks = Array.from({ length: 6 }, (_, day) => ((day + 1) / 7) * 100);

const DEFINITIONS = [
  {
    name: "geminiRolling" as const,
    label: "Gemini · 5 часов",
    shortLabel: "G5ч",
    periodSeconds: USAGE_PERIOD_SECONDS.hours5,
    ticks: [20, 40, 60, 80],
  },
  {
    name: "geminiWeekly" as const,
    label: "Gemini · неделя",
    shortLabel: "Gнед",
    periodSeconds: USAGE_PERIOD_SECONDS.week,
    ticks: weekTicks,
  },
  {
    name: "thirdPartyRolling" as const,
    label: "Claude/GPT · 5 часов",
    shortLabel: "3p5ч",
    periodSeconds: USAGE_PERIOD_SECONDS.hours5,
    ticks: [20, 40, 60, 80],
  },
  {
    name: "thirdPartyWeekly" as const,
    label: "Claude/GPT · неделя",
    shortLabel: "3pнед",
    periodSeconds: USAGE_PERIOD_SECONDS.week,
    ticks: weekTicks,
  },
];

const CYCLE_ORDER: readonly AntigravityUsageWindowName[] = [
  "geminiRolling",
  "geminiWeekly",
  "thirdPartyRolling",
  "thirdPartyWeekly",
];

// Shared across status bar and session menu instances so a manual refresh updates every mount.
const sharedUsage = shallowRef<AntigravityUsage | null>(null);
const sharedFailed = ref(false);
const sharedRefreshing = ref(false);
let initialLoad: Promise<void> | undefined;

async function loadCachedOnce(): Promise<void> {
  if (sharedUsage.value) return;
  initialLoad ??= readCachedAntigravityUsage()
    .then((value) => {
      sharedUsage.value = value;
      sharedFailed.value = false;
    })
    .catch(() => {
      sharedFailed.value = true;
    })
    .finally(() => {
      initialLoad = undefined;
    });
  return initialLoad;
}

async function manualRefresh(): Promise<AntigravityUsage | null> {
  if (sharedRefreshing.value) return sharedUsage.value;
  sharedRefreshing.value = true;
  try {
    sharedUsage.value = await refreshAntigravityUsageApi();
    sharedFailed.value = false;
    return sharedUsage.value;
  } catch {
    sharedFailed.value = true;
    return null;
  } finally {
    sharedRefreshing.value = false;
  }
}

/**
 * Manual-only Antigravity usage indicator: never polls in the background. Reads cached state once
 * on mount (`GET /api/antigravity/usage`) and runs `agy -p "/usage"` only on explicit user refresh.
 */
export function useAntigravityUsageIndicator() {
  const now = useNow({ scheduler: (update) => useIntervalFn(update, 1000) });
  const windows = useUsageWindows<AntigravityUsageWindowName>({
    title: "Antigravity",
    definitions: DEFINITIONS,
    cycleOrder: CYCLE_ORDER,
    initial: "geminiRolling",
    usage: () => sharedUsage.value,
    windows: () => sharedUsage.value?.windows,
    failed: () => sharedFailed.value,
    now: () => now.value.getTime(),
  });
  const commands = useCommandScope(`antigravityUsage:${useId()}`, () => ({
    surface: "statusBar",
    window: windows.selectedWindow.value,
    refreshing: sharedRefreshing.value,
  }));
  commands.scope.registerCommand({
    id: "ide.antigravity.usage.window.cycle",
    title: "Переключить отображаемый лимит Antigravity",
    description:
      "Меняет окно индикатора Antigravity в статусной строке: Gemini 5ч → Gemini неделя → Claude/GPT 5ч → Claude/GPT неделя, пропуская окна без данных. Не запускает agy.",
    run: windows.cycle,
  });
  commands.scope.registerCommand({
    id: "ide.antigravity.usage.refresh",
    title: "Обновить лимиты Antigravity вручную",
    description:
      'Запускает официальную команду agy -p "/usage" для измерения текущих квот Gemini и Claude/GPT и записывает результат в аналитику.',
    enabled: () => !sharedRefreshing.value,
    run: manualRefresh,
  });
  publishAgentUsage("antigravity", windows.remaining, windows.tone);
  onMounted(() => void loadCachedOnce());

  return {
    usage: sharedUsage,
    refreshing: sharedRefreshing,
    commands,
    ...windows,
  };
}
