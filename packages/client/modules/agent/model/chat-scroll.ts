import { nextTick, onBeforeUnmount, onMounted, ref, watch, type Ref } from "vue";
import type { AgentTurn } from "./types.ts";

const BOTTOM_GAP = 72;

/**
 * Scroll behaviour of the chat log: the latest message stays pinned while content grows, a user
 * scrolling up detaches it, and content near the top loads older requests.
 */
export function useChatScroll(options: {
  turns: Ref<AgentTurn[]>;
  log: Ref<HTMLElement | undefined>;
  topUp: (fill?: boolean) => Promise<void>;
  preloadPx: number;
  watchSource: () => readonly unknown[];
  onShown?: () => void;
}) {
  const away = ref(false);
  let lastTop = 0;
  let lastHeight = 0;
  let frame = 0;
  let observer: ResizeObserver | undefined;
  let observed: Element | undefined;

  /** Keeps the measured position after older requests were mounted above. */
  function rememberScroll() {
    const element = options.log.value;
    if (!element) return;
    lastTop = element.scrollTop;
    lastHeight = element.scrollHeight;
  }

  // Content growth never changes scrollTop, so only a decrease is a user scrolling up.
  // Shrinking content (a collapsing thought block) clamps scrollTop by itself: that is not the user.
  function trackScroll() {
    const element = options.log.value;
    if (!element || !element.clientHeight) return;
    const top = element.scrollTop;
    const shrunk = element.scrollHeight < lastHeight;
    lastHeight = element.scrollHeight;
    if (element.scrollHeight - top - element.clientHeight <= BOTTOM_GAP) away.value = false;
    else if (top < lastTop && !shrunk) away.value = true;
    lastTop = top;
    if (top < options.preloadPx) void options.topUp();
  }

  function pin() {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      const element = options.log.value;
      if (!element || away.value) return;
      element.scrollTop = options.turns.value.length ? element.scrollHeight : 0;
      lastTop = element.scrollTop;
      lastHeight = element.scrollHeight;
    });
  }

  async function toBottom() {
    away.value = false;
    await nextTick();
    pin();
  }

  function observeContent() {
    const content = options.log.value?.firstElementChild;
    if (!observer || !content || content === observed) return;
    if (observed) observer.unobserve(observed);
    observer.observe(content);
    observed = content;
  }

  watch(
    options.watchSource,
    async () => {
      pin();
      await nextTick();
      observeContent();
      // A short window leaves no room to scroll: fill it from above.
      void options.topUp(true);
    },
    { deep: true },
  );

  onMounted(() => {
    observer = new ResizeObserver(() => {
      pin();
      options.onShown?.();
    });
    if (options.log.value) observer.observe(options.log.value);
    observeContent();
  });

  onBeforeUnmount(() => {
    observer?.disconnect();
    cancelAnimationFrame(frame);
  });

  return { away, trackScroll, pin, toBottom, rememberScroll, observeContent };
}
