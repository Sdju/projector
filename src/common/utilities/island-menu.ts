import { computed, nextTick, onBeforeUnmount, ref, useId, type CSSProperties } from "vue";
import { onClickOutside, useEventListener } from "@vueuse/core";
import { useCompactViewport } from "./compact-viewport.ts";

/** Общий lifecycle острова; содержимое и политика обхода остаются у владельца. */
export function useIslandMenu(options: {
  anchor: "left" | "right";
  initialFocus: string | readonly string[];
  returnFocus?: string;
  items?: string;
  horizontalArrows?: boolean;
  closeOnTab?: boolean;
}) {
  const open = ref(false);
  const trigger = ref<HTMLElement>();
  const island = ref<HTMLElement>();
  const active = ref(0);
  const compact = useCompactViewport();
  const id = useId();
  const origin = ref<CSSProperties>({});
  const style = computed(() => (compact.value ? undefined : origin.value));
  let generation = 0;
  let disposed = false;
  const items = () => [
    ...(island.value?.querySelectorAll<HTMLElement>(options.items ?? "button") ?? []),
  ];
  const available = () => items().filter((item) => !item.matches(":disabled"));

  function trackFocus() {
    const index = items().indexOf(document.activeElement as HTMLElement);
    if (index >= 0) active.value = index;
  }
  function close(restoreFocus = true) {
    if (!open.value) return;
    ++generation;
    open.value = false;
    if (restoreFocus && !disposed)
      trigger.value?.querySelector<HTMLElement>(options.returnFocus ?? "button")?.focus();
  }
  async function toggle(force = !open.value) {
    if (disposed || force === open.value) return;
    if (!force) return close();
    const bounds = trigger.value?.getBoundingClientRect();
    if (!bounds) return;
    const current = ++generation;
    const top = Math.max(8, bounds.top - 4);
    origin.value = {
      [options.anchor]: `${options.anchor === "left" ? bounds.left - 4 : window.innerWidth - bounds.right - 4}px`,
      top: `${top}px`,
      "--island-top": `${top}px`,
    };
    active.value = 0;
    open.value = true;
    await nextTick();
    if (disposed || !open.value || current !== generation) return;
    if (!compact.value && island.value) {
      const width = island.value.getBoundingClientRect().width;
      const offset =
        options.anchor === "left" ? bounds.left - 4 : window.innerWidth - bounds.right - 4;
      origin.value = {
        ...origin.value,
        [options.anchor]: `${Math.max(8, Math.min(offset, window.innerWidth - width - 8))}px`,
      };
    }
    const selectors =
      typeof options.initialFocus === "string" ? [options.initialFocus] : options.initialFocus;
    const first = selectors
      .map((selector) => island.value?.querySelector<HTMLElement>(selector))
      .find((item) => item && !item.matches(":disabled"));
    (
      first ??
      available()[0] ??
      island.value?.querySelector<HTMLElement>("button:not(:disabled)")
    )?.focus();
    trackFocus();
  }
  function keydown(event: KeyboardEvent) {
    if (event.defaultPrevented || event.isComposing) return;
    if (event.key === "Escape") {
      event.preventDefault();
      close();
    } else if (event.key === "Tab" && options.closeOnTab) {
      // Return to the trigger before native Tab moves to the next/previous control.
      close();
    } else {
      const next =
        event.key === "ArrowDown" || (options.horizontalArrows && event.key === "ArrowRight");
      const previous =
        event.key === "ArrowUp" || (options.horizontalArrows && event.key === "ArrowLeft");
      if (!next && !previous) return;
      const list = available();
      if (!list.length) return;
      event.preventDefault();
      const index = list.indexOf(document.activeElement as HTMLElement);
      const target =
        index < 0
          ? next
            ? 0
            : list.length - 1
          : (index + (next ? 1 : -1) + list.length) % list.length;
      list[target]?.focus();
      trackFocus();
    }
  }
  onClickOutside(island, () => close(false), { ignore: [trigger] });
  useEventListener(window, "resize", () => close());
  useEventListener(window, "blur", () => close(false));
  onBeforeUnmount(() => {
    disposed = true;
    ++generation;
    open.value = false;
  });
  return { open, trigger, island, active, compact, id, style, toggle, close, keydown, trackFocus };
}
