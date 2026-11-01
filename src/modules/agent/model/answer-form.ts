import { computed, nextTick, type Ref } from "vue";
import { answerFormSource } from "../../widget-runtime/index.ts";
import type { AgentFormAnswer, AgentTurn, MessagePart } from "./types.ts";

/**
 * The form that replaces the composer: the last block of the last finished answer. Sending it
 * stores the block and the values on the user's message, so the chat can show the same form again.
 */
export function useAnswerForm(options: {
  turns: Ref<AgentTurn[]>;
  busy: Ref<boolean>;
  draft: Ref<string>;
  draftParts: Ref<MessagePart[]>;
  send: (
    text?: string,
    chips?: MessagePart[],
    options?: { auto?: string; form?: AgentFormAnswer },
  ) => Promise<void>;
  edit: (id: string) => void;
}) {
  const pendingForm = computed(() => {
    if (options.busy.value) return undefined;
    const last = options.turns.value.at(-1);
    return last?.role === "assistant" ? answerFormSource(last.text) : undefined;
  });

  async function sendForm(
    text: string,
    data: unknown,
    summary: string | undefined,
    source: string,
    editId?: string,
  ) {
    if (editId) options.edit(editId);
    options.draft.value = text;
    options.draftParts.value = [];
    await nextTick();
    await options.send(undefined, undefined, {
      form: { source, values: data, ...(summary ? { summary } : {}) },
    });
  }

  function submitComposerForm(
    text: string,
    data: unknown,
    summary: string | undefined,
    source: string,
  ) {
    return sendForm(text, data, summary, source);
  }

  function submitTurnForm(id: string, text: string, data: unknown, summary?: string) {
    const turn = options.turns.value.find((item) => item.id === id && item.role === "user");
    if (turn?.form) return sendForm(text, data, summary, turn.form.source, id);
  }

  return { pendingForm, submitComposerForm, submitTurnForm };
}
