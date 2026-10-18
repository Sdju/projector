import type { ComputedRef, InjectionKey } from "vue";

/** `<Tabs>` with `<Tab title>` panels: each panel registers its title, the container shows one. */
export interface TabsContext {
  active: ComputedRef<string | undefined>;
  register(title: string, hint?: string): () => void;
}
export const tabsKey: InjectionKey<TabsContext> = Symbol("agent-widget-tabs");
