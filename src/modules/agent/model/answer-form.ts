import { computed, nextTick, shallowRef, watch, type Ref } from "vue";
import {
  answerFormSource,
  doctorFormSource,
  formProblem,
  heuristicFormRepair,
} from "../../widget-runtime/index.ts";
import { repairForm } from "../api/client.ts";
import type { AgentFormAnswer, AgentSelection, AgentTurn, MessagePart } from "./types.ts";

const FORM_DOCTOR_ATTEMPTS = 3;

/** Enough context for a repair, without sending the whole conversation to the doctor. */
function formHistory(turns: AgentTurn[]): string {
  return turns
    .slice(-16)
    .map((turn) => `${turn.role === "user" ? "Пользователь" : "Ассистент"}: ${turn.text}`)
    .join("\n\n")
    .slice(-20_000);
}

/**
 * The form that replaces the composer: the last block of the last finished answer. Sending it
 * stores the block and the values on the user's message, so the chat can show the same form again.
 *
 * A compiler failure is repaired before the user sees it: first without a model, then by the
 * Projector doctor, which gets the conversation and the compiler error and is checked again.
 */
export function useAnswerForm(options: {
  turns: Ref<AgentTurn[]>;
  busy: Ref<boolean>;
  draft: Ref<string>;
  draftParts: Ref<MessagePart[]>;
  selection?: Ref<AgentSelection>;
  send: (
    text?: string,
    chips?: MessagePart[],
    options?: { auto?: string; form?: AgentFormAnswer },
  ) => Promise<void>;
  edit: (id: string) => void;
}) {
  const rawForm = computed(() => {
    if (options.busy.value) return undefined;
    const last = options.turns.value.at(-1);
    return last?.role === "assistant" ? answerFormSource(last.text) : undefined;
  });
  const pendingForm = shallowRef<string>();
  /** What the answer actually contains: the message hides this block while the composer shows a form. */
  const originalForm = shallowRef<string>();
  const repairing = shallowRef(false);
  const repairError = shallowRef("");
  let generation = 0;
  let controller: AbortController | undefined;

  async function prepare(source: string | undefined): Promise<void> {
    const run = ++generation;
    controller?.abort();
    controller = undefined;
    pendingForm.value = undefined;
    originalForm.value = source;
    repairing.value = false;
    repairError.value = "";
    if (!source) return;
    let candidate = heuristicFormRepair(source);
    let problem = await formProblem(candidate);
    if (run !== generation) return;
    if (!problem) {
      pendingForm.value = candidate;
      return;
    }
    repairing.value = true;
    const next = new AbortController();
    controller = next;
    for (let attempt = 0; attempt < FORM_DOCTOR_ATTEMPTS && !next.signal.aborted; attempt++) {
      try {
        const answer = await repairForm({
          form: candidate,
          error: problem,
          history: formHistory(options.turns.value),
          selection: options.selection?.value,
          signal: next.signal,
        });
        if (run !== generation || next.signal.aborted) return;
        const extracted = doctorFormSource(answer);
        if (!extracted) {
          problem = "Form Doctor вернул не форму";
          continue;
        }
        candidate = heuristicFormRepair(extracted);
        problem = await formProblem(candidate);
        if (run !== generation || next.signal.aborted) return;
        if (!problem) {
          pendingForm.value = candidate;
          return;
        }
      } catch (error) {
        if (run !== generation || next.signal.aborted) return;
        problem = error instanceof Error ? error.message : String(error);
      }
    }
    if (run === generation) {
      repairing.value = false;
      repairError.value = problem ?? "Не удалось восстановить форму";
    }
  }

  watch(rawForm, (source) => void prepare(source), { immediate: true });

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

  return {
    pendingForm,
    originalForm,
    repairing,
    repairError,
    submitComposerForm,
    submitTurnForm,
  };
}
