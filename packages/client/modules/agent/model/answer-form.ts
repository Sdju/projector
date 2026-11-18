import { computed, nextTick, shallowRef, watch, type Ref } from "vue";
import {
  answerFormSource,
  doctorFormSource,
  doctorVerdict,
  formatProblems,
  formProblems,
  heuristicFormRepair,
  type AnswerProblem,
} from "../../widget-runtime/index.ts";
import { repairForm } from "../../agent-core/index.ts";
import type {
  AgentFormAnswer,
  AgentSelection,
  AgentTurn,
  MessagePart,
} from "../../agent-core/index.ts";
import { textFingerprint } from "./fingerprint.ts";

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
 * Forms already answered: a user turn with a snapshot always follows the answer it came from.
 * Pairing the neighbouring turns survives reloads, retries and edits of the snapshot.
 */
export function answeredFormSources(turns: AgentTurn[], projectId?: string): Map<string, string> {
  const result = new Map<string, string>();
  for (let index = 0; index < turns.length - 1; index++) {
    const turn = turns[index];
    const next = turns[index + 1];
    if (turn.role !== "assistant" || next.role !== "user" || !next.form) continue;
    const source = answerFormSource(turn.text, projectId);
    if (source) result.set(turn.id, source);
  }
  return result;
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
  /** The project whose trusted widgets may own the answer form. */
  projectId?: string;
  /** Saves a doctor verdict with the chat, so a reload does not ask the same question again. */
  persist?: () => void;
}) {
  const rawForm = computed(() => {
    if (options.busy.value) return undefined;
    const last = options.turns.value.at(-1);
    return last?.role === "assistant" ? answerFormSource(last.text, options.projectId) : undefined;
  });
  const pendingForm = shallowRef<string>();
  /** What the answer actually contains: the message hides this block while the composer shows a form. */
  const originalForm = shallowRef<string>();
  /** A sent form is shown by the user's snapshot only: the answer must not offer it again. */
  const answeredForms = computed(() => answeredFormSources(options.turns.value, options.projectId));
  /** What this answer must hide: the composer owns the active form, the snapshot owns the sent one. */
  function answerFormFor(turn: AgentTurn): { promotedForm?: string; formAnswered?: boolean } {
    if (turn.role !== "assistant") return {};
    if (turn.id === options.turns.value.at(-1)?.id)
      return originalForm.value ? { promotedForm: originalForm.value } : {};
    const source = answeredForms.value.get(turn.id);
    return source ? { promotedForm: source, formAnswered: true } : {};
  }
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
    const turn = options.turns.value.at(-1);
    const saved = turn?.role === "assistant" ? turn.formRepair : undefined;
    // The doctor already said the check is wrong: show the same form, do not ask again.
    if (saved?.status === "accepted" && saved.source === textFingerprint(source)) {
      pendingForm.value = heuristicFormRepair(source);
      return;
    }
    let candidate = heuristicFormRepair(source);
    let problems: AnswerProblem[] = await formProblems(candidate, options.projectId);
    if (run !== generation) return;
    if (!problems.length) {
      pendingForm.value = candidate;
      return;
    }
    repairing.value = true;
    const next = new AbortController();
    controller = next;
    const originalError = formatProblems(problems);
    let diagnosis = originalError;
    let previous: string | undefined;
    for (let attempt = 0; attempt < FORM_DOCTOR_ATTEMPTS && !next.signal.aborted; attempt++) {
      try {
        const reply = await repairForm({
          form: candidate,
          error: diagnosis,
          original: source,
          originalError,
          previous,
          attempt: attempt + 1,
          limit: FORM_DOCTOR_ATTEMPTS,
          history: formHistory(options.turns.value),
          selection: options.selection?.value,
          signal: next.signal,
        });
        if (run !== generation || next.signal.aborted) return;
        previous = reply;
        const verdict = doctorVerdict(reply);
        if (verdict) {
          if (!problems.every((problem) => problem.soft)) {
            // A compiler error is a fact: the check keeps the form out of the composer.
            repairing.value = false;
            repairError.value = `${diagnosis} · вердикт доктора отклонён: ${verdict.reason}`;
            return;
          }
          pendingForm.value = candidate;
          repairing.value = false;
          if (turn?.role === "assistant") {
            turn.formRepair = {
              status: "accepted",
              attempts: attempt + 1,
              problem: originalError,
              reason: verdict.reason,
              source: textFingerprint(source),
              at: Date.now(),
            };
            options.persist?.();
          }
          return;
        }
        const extracted = doctorFormSource(reply, options.projectId);
        if (!extracted) {
          diagnosis = "Form Doctor вернул не форму";
          continue;
        }
        candidate = heuristicFormRepair(extracted);
        const nextProblems = await formProblems(candidate, options.projectId);
        if (run !== generation || next.signal.aborted) return;
        if (!nextProblems.length) {
          pendingForm.value = candidate;
          repairing.value = false;
          return;
        }
        problems = nextProblems;
        diagnosis = formatProblems(nextProblems);
      } catch (error) {
        if (run !== generation || next.signal.aborted) return;
        diagnosis = error instanceof Error ? error.message : String(error);
      }
    }
    if (run === generation) {
      repairing.value = false;
      repairError.value = diagnosis || "Не удалось восстановить форму";
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
    answeredForms,
    answerFormFor,
    repairing,
    repairError,
    submitComposerForm,
    submitTurnForm,
  };
}
