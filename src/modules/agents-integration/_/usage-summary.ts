import { onBeforeUnmount, reactive, watchEffect, type Ref } from "vue";
import type { UsagePaceTone } from "./usage-pace.ts";

export interface AgentUsageSummary {
  /** Остаток отображаемого окна лимита, %; `null` — лимиты недоступны. */
  remaining: number | null;
  tone: UsagePaceTone | null;
}

/** Последнее значение, которое показывает индикатор каждого агента: из него же строится цвет в списках. */
export const agentUsageSummary = reactive<Record<string, AgentUsageSummary>>({});

/** Индикатор публикует то, что рисует, чтобы другие списки показывали тот же остаток и цвет. */
export function publishAgentUsage(
  agent: string,
  remaining: Readonly<Ref<number | null>>,
  tone: Readonly<Ref<UsagePaceTone | null>>,
) {
  watchEffect(() => {
    agentUsageSummary[agent] = { remaining: remaining.value, tone: tone.value };
  });
  onBeforeUnmount(() => delete agentUsageSummary[agent]);
}
