import type { Component } from "vue";

/**
 * Части карточки провайдера, которые зависят от вида. Общая панель не знает ни об одном
 * провайдере: модуль вида регистрирует свой компонент и получает выбранного провайдера.
 */
export interface ProviderKindExtra {
  kind: string;
  component: Component;
}

const extras = new Map<string, ProviderKindExtra>();

/** Регистрация заменяет прежний компонент вида: HMR и повторный composition не плодят дубли. */
export function registerProviderKindExtra(extra: ProviderKindExtra): void {
  extras.set(extra.kind, extra);
}

export function providerKindExtra(kind: string | undefined): ProviderKindExtra | undefined {
  return kind ? extras.get(kind) : undefined;
}
