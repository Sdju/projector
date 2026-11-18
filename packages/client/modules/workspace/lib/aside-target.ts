import type { InjectionKey, ShallowRef } from "vue";

/**
 * The element of the right-rail section «Терминалы». The dock waits for this ref before it
 * teleports the terminal group, so the target already exists when the teleport mounts.
 */
export const asideTargetKey: InjectionKey<ShallowRef<HTMLElement | undefined>> =
  Symbol("projector-aside-target");
