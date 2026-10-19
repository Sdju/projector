import { onBeforeUnmount, reactive, watchEffect, type Ref } from "vue";
import type { UsagePaceTone } from "./usage-pace.ts";

export interface AgentUsageSummary {
  /** Остаток отображаемого окна лимита, %; `null` — лимиты недоступны. */
  remaining: number | null;
  tone: UsagePaceTone | null;
}

/** Последнее значение, которое показывает индикатор каждого агента: из него же строится цвет в списках. */
export const agentUsageSummary = reactive<Record<string, AgentUsageSummary>>({});

/** Баланс активного провайдера для строки «Чат с агентом»: готовый текст, а не процент. */
export const providerBalanceSummary = reactive<{ text: string | null; tone: UsagePaceTone | null }>(
  {
    text: null,
    tone: null,
  },
);

export function publishProviderBalance(
  text: Readonly<Ref<string | null>>,
  tone: Readonly<Ref<UsagePaceTone | null>>,
) {
  watchEffect(() => {
    providerBalanceSummary.text = text.value;
    providerBalanceSummary.tone = tone.value;
  });
  onBeforeUnmount(() => {
    providerBalanceSummary.text = null;
    providerBalanceSummary.tone = null;
  });
}

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
