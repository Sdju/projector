import type { ChatComposer, ChatForms, MessageChip } from "../../../../agent-core/index.ts";

/** What the composer publishes to the chat's commands: the draft, never the sending. */
export interface ChatComposerHandle {
  attach(chips: MessageChip[]): Promise<void>;
  appendText(text: string): Promise<void>;
  showForm(): void;
  hideForm(): void;
}

/** The parameters island of the composer. */
export interface ChatControlsHandle {
  toggle(): void;
}

/**
 * The composer's part of the chat contract: commands add chips or text to the draft, and the form
 * the last answer ended with can be shown or hidden. Both live in the mounted component, so the
 * group reads them through its refs.
 */
export function chatComposerGroup(
  composer: () => ChatComposerHandle | undefined,
  controls: () => ChatControlsHandle | undefined,
  pendingForm: () => string | undefined,
): ChatComposer & ChatForms {
  return {
    attach: async (chips) => composer()?.attach(chips),
    appendText: async (text) => composer()?.appendText(text),
    pendingForm,
    showForm: () => composer()?.showForm(),
    hideForm: () => composer()?.hideForm(),
    toggleControlsMenu: () => controls()?.toggle(),
  };
}
