import { nextTick, watch, type Ref } from "vue";
import { chatsOf } from "../../agent-core/index.ts";
import { zenMode } from "../../../common/utilities/zen-mode.ts";

/** Возвращает фокус в поле ввода при выходе из режима Zen, если этот чат сейчас активен. */
export function useChatZenFocus(options: {
  projectId: string;
  chatKey: string;
  viewed: Ref<string>;
  root: Ref<HTMLElement | undefined>;
  focusComposer: () => void;
}) {
  watch(zenMode, async (on, was) => {
    if (!was || on || options.viewed.value) return;
    await nextTick();
    const element = options.root.value;
    if (!element || element.getClientRects().length === 0) return;
    if (chatsOf(options.projectId)[0]?.key !== options.chatKey) return;
    const active = document.activeElement;
    if (
      !active ||
      active === document.body ||
      active === document.documentElement ||
      element.contains(active) ||
      active.classList.contains("zen-exit")
    ) {
      options.focusComposer();
    }
  });
  return zenMode;
}
