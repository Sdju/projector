import { computed, nextTick, ref, watch, type Ref } from "vue";
import type { AgentTurn } from "./types.ts";

/** Requests mounted at first and added each time the top is reached. */
const PAGE = 5;
/** How close to the top (px) the older requests start to mount. */
const PRELOAD_PX = 400;

/**
 * A long chat is mounted from its end: older requests join in portions as the top is reached, so
 * opening a chat costs the same however long it is. `log` is the scrolling element; `settled` runs
 * after a portion was added, when the scroll position was restored.
 */
export function useChatWindow(
  turns: Ref<AgentTurn[]>,
  log: Ref<HTMLElement | undefined>,
  settled: () => void,
  /** The chat is not on screen yet (its history is being fetched): nothing to measure. */
  waiting: Ref<boolean>,
) {
  const visible = ref(PAGE);
  const requests = computed(() => turns.value.filter((turn) => turn.role === "user").length);
  const firstShown = computed(() => {
    let seen = 0;
    for (let index = turns.value.length - 1; index >= 0; index--)
      if (turns.value[index]!.role === "user" && ++seen === visible.value) return index;
    return 0;
  });
  const shown = computed(() =>
    firstShown.value ? turns.value.slice(firstShown.value) : turns.value,
  );
  const hidden = computed(
    () => turns.value.slice(0, firstShown.value).filter((turn) => turn.role === "user").length,
  );
  // Another chat or session replaces the turns: start from its end again.
  watch(
    () => turns.value[0]?.id,
    () => {
      visible.value = PAGE;
    },
  );
  // What the user sends joins the window, so the top it is reading never moves.
  watch(requests, (now, before) => {
    if (now === before + 1) visible.value += 1;
  });

  let loading = false;
  /** Mounts older requests above and keeps what is on screen where it was. */
  async function loadEarlier(): Promise<boolean> {
    const element = log.value;
    if (!element || !hidden.value || loading || waiting.value) return false;
    loading = true;
    try {
      const height = element.scrollHeight;
      const top = element.scrollTop;
      visible.value += PAGE;
      await nextTick();
      element.scrollTop = top + element.scrollHeight - height;
      settled();
      return true;
    } finally {
      loading = false;
    }
  }
  /**
   * Older requests are mounted while the top is near, so scrolling up never meets an edge. `fill`
   * is for a window too short to scroll at all (the view is not yet pinned to the bottom).
   */
  async function topUp(fill = false) {
    const element = log.value;
    const near = () =>
      !!element &&
      (fill ? element.scrollHeight - element.clientHeight : element.scrollTop) < PRELOAD_PX;
    while (element && hidden.value && element.clientHeight && near())
      if (!(await loadEarlier())) return;
  }
  // The conversation appears when loading ends: a short window is filled then.
  watch(waiting, async (now) => {
    if (now) return;
    await nextTick();
    void topUp(true);
  });
  return { PRELOAD_PX, firstShown, shown, hidden, loadEarlier, topUp };
}
