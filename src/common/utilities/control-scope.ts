import type { ComputedRef, CSSProperties, InjectionKey } from "vue";

export const controlScopeKey: InjectionKey<ComputedRef<CSSProperties | undefined>> =
  Symbol("ui-control-scope");
