import { nextTick, type Ref } from "vue";
import type { SideQuestion } from "../modules/panels/index.ts";
import type { MessagePart } from "../../agent-core/index.ts";

export { useChatRetry } from "./use-chat-retry.ts";

/** What the composer and the welcome suggestions do to the chat, without the chat's layout. */
export function useChatInputActions(options: {
  draft: Ref<string>;
  draftParts: Ref<MessagePart[]>;
  send: (text?: string, chips?: MessagePart[]) => Promise<void>;
  side: SideQuestion;
  clear: () => Promise<void>;
  toBottom: () => Promise<void>;
  resetAway: () => void;
  focus: () => void;
}) {
  async function submit() {
    if (!options.draft.value.trim()) return;
    const asked = options.side.command(options.draft.value);
    if (asked !== undefined) {
      options.draft.value = "";
      options.draftParts.value = [];
      options.side.openPanel();
      if (asked) void options.side.ask(asked).catch(() => {});
      return;
    }
    void options.toBottom();
    await options.send();
    options.focus();
  }
  async function continueTurn() {
    void options.toBottom();
    await options.send("продолжай");
  }
  async function suggest(text: string) {
    options.draft.value = text;
    await nextTick();
    options.focus();
  }
  async function newChat() {
    options.side.reset();
    await options.clear();
    options.resetAway();
    options.focus();
  }
  return { submit, continueTurn, suggest, newChat };
}
