import type { Component } from "vue";
import type { IconName } from "../../../common/icons/registry.ts";
import { clientAgents } from "../catalog/index.ts";
import { ProviderBalanceIndicator } from "../provider/index.ts";
import { PluginUsageIndicator } from "../usage/index.ts";

/**
 * Один индикатор лимитов в статусной строке. Идентификатор не зависит от порядка отрисовки:
 * по нему сохраняются видимость и место индикатора, поэтому он же уходит в IDE-команды.
 */
export interface UsageBarItem {
  id: string;
  title: string;
  icon: IconName;
  component: Component;
  props?: Record<string, unknown>;
}

/**
 * Индикаторы всех включённых агентов и общий баланс кошельков. Отключённый агент не попадает
 * в список: его сервис не должен опрашиваться только ради скрытой строки.
 */
export function usageBarItems(enabled?: (program: string) => boolean): UsageBarItem[] {
  const items: UsageBarItem[] = clientAgents().flatMap((agent) => {
    const usage = agent.usage ?? (agent.usageUrl ? PluginUsageIndicator : undefined);
    if (!usage || !(enabled?.(agent.program) ?? true)) return [];
    return [
      {
        id: `usage:${agent.backend}`,
        title: agent.title,
        icon: agent.icon,
        component: usage,
        props: agent.usageProps,
      },
    ];
  });
  items.push({
    id: "balance",
    title: "Баланс провайдеров",
    icon: "wallet",
    component: ProviderBalanceIndicator,
  });
  return items;
}
