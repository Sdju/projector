import { computed, ref, watch, type Ref } from "vue";
import type { AgentPresetView } from "@ai-projector/core/modules/agent-preset/index.ts";
import type { AgentFormAnswer, AgentTurn, MessagePart } from "../../agent-core/index.ts";

/**
 * A starter preset with a form: it opens in the composer, exactly like a form an answer ends with.
 * The last answer's form returns as soon as the preset is sent or the chat changes.
 */
export function useStartPreset(options: {
  turns: Ref<AgentTurn[]>;
  /** The chat key: a new chat starts from the text field, not a leftover starter form. */
  chat: () => string;
  /** The form the last answer left in the composer. */
  pendingForm: Ref<string | undefined>;
  send: (
    text?: string,
    chips?: MessagePart[],
    options?: { form?: AgentFormAnswer },
  ) => Promise<void>;
  /** Sends a form that did not come from a starter preset. */
  submitAnswerForm: (
    text: string,
    data: unknown,
    summary: string | undefined,
    source: string,
  ) => void;
  toBottom: () => void;
}) {
  const preset = ref<AgentPresetView>();
  /** A starter preset wins over the last answer's form. */
  const form = computed(() => preset.value?.form ?? options.pendingForm.value);

  function open(value: AgentPresetView) {
    preset.value = value;
    options.toBottom();
  }
  function close() {
    preset.value = undefined;
  }
  function submit(text: string, data: unknown, summary: string | undefined, source: string) {
    const active = preset.value;
    if (!active?.form || source !== active.form) {
      options.submitAnswerForm(text, data, summary, source);
      return;
    }
    preset.value = undefined;
    const prompt = active.prompt.trim();
    const message = prompt ? `${prompt}\n\n${text}` : text;
    options.toBottom();
    void options.send(message, undefined, {
      form: { source: active.form, values: data, ...(summary ? { summary } : {}) },
    });
  }

  watch([() => options.turns.value.length, options.chat], close);
  return { form, open, close, submit };
}
