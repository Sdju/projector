import { useId } from "vue";
import { useIntervalFn, useNow } from "@vueuse/core";
import { useCommandScope } from "../../../common/utilities/commands.ts";
import { publishAgentUsage } from "./usage-summary.ts";
import { useUsagePolling, type UsagePollingOptions } from "./use-usage-polling.ts";
import {
  useUsageWindows,
  type UsageWindowData,
  type UsageWindowDefinition,
} from "./usage-windows.ts";

/**
 * Polling, clock, window selection, status-bar command and the published summary of an agent
 * limit indicator. Adapters keep their endpoint, windows, labels and tooltip.
 */
export function useAgentUsageIndicator<T, Name extends string>(options: {
  agent: string;
  title: string;
  endpoint: string;
  polling?: UsagePollingOptions<T>;
  definitions: readonly UsageWindowDefinition<Name>[];
  cycleOrder: readonly Name[];
  initial: Name;
  usage: (value: T | null) => { status: string; message?: string | null } | null;
  windows: (value: T | null) => Partial<Record<Name, UsageWindowData | null>> | null | undefined;
  command: { id: string; title: string; description: string };
}) {
  const { usage, failed } = useUsagePolling<T>(options.endpoint, options.polling);
  const now = useNow({ scheduler: (update) => useIntervalFn(update, 1000) });
  const windows = useUsageWindows<Name>({
    title: options.title,
    definitions: options.definitions,
    cycleOrder: options.cycleOrder,
    initial: options.initial,
    usage: () => options.usage(usage.value),
    windows: () => options.windows(usage.value),
    failed: () => failed.value,
    now: () => now.value.getTime(),
  });
  const commands = useCommandScope(`${options.agent}Usage:${useId()}`, () => ({
    surface: "statusBar",
    window: windows.selectedWindow.value,
  }));
  commands.scope.registerCommand({ ...options.command, run: windows.cycle });
  publishAgentUsage(options.agent, windows.remaining, windows.tone);
  return { usage, failed, commands, ...windows };
}
