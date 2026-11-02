import { onScopeDispose, reactive, watch, type Ref } from "vue";
import { fetchLens, type LensStateReport } from "../api/lens.ts";
import { chatHistory } from "./chat-state.ts";
import type { PlanItem } from "../lib/plan.ts";
import type { AgentHistoryTurn, AgentSelection, AgentTurn, QueuedMessage } from "./types.ts";

/** While the agent is busy, Lens asks again this often; the panel also refreshes on demand. */
export const LENS_INTERVAL_MS = 20_000;
const LENS_TURNS = 20;
const LENS_TOOL_INPUT = 300;
const LENS_RUNNING_TOOLS = 8;
/** Shown without a request until the answer has reasoning, text or a running call to read. */
export const LENS_THINKING_TEXT = "Агент обдумывает задачу…";
/** Wait for the first reasoning to accumulate before asking the model for a caption. */
const LENS_FIRST_DELAY_MS = 1_500;
/** A step change that arrives during a request is asked about right after it. */
const LENS_RETRY_MS = 500;

export interface AgentLensOptions {
  turns: Ref<AgentTurn[]>;
  busy: Ref<boolean>;
  phase: Ref<string>;
  queue: Ref<QueuedMessage[]>;
  plan: Ref<PlanItem[]>;
  selection: Ref<AgentSelection>;
  /** Tests shorten this; the page uses {@link LENS_INTERVAL_MS}. */
  intervalMs?: number;
}

/**
 * The conversation Lens reads: the last exchanges, including the answer still being written — the
 * partial text is exactly what "what is the agent doing now" is about. Running calls are reported
 * separately in the state, so they are not repeated here.
 */
export function lensHistory(turns: AgentTurn[]): AgentHistoryTurn[] {
  const history = chatHistory(turns, true, true).slice(-LENS_TURNS);
  let start = 0;
  while (start < history.length && history[start]!.role !== "user") start++;
  return history.slice(start);
}

/**
 * Whether the answer being written has something to describe. The start of a turn is just a
 * placeholder: asking the model then produces "there are no messages yet" instead of a caption.
 */
export function lensHasMaterial(turns: AgentTurn[], plan: PlanItem[] = []): boolean {
  // A plan names the current step even before the model has reasoned about it.
  if (plan.some((item) => item.status !== "completed")) return true;
  const last = turns.at(-1);
  if (last?.role !== "assistant") return false;
  if (last.text.trim()) return true;
  if (last.tools.some((tool) => tool.status === "running" && !tool.parent)) return true;
  return (last.parts ?? []).some((part) => part.type === "thought" && part.text.trim());
}

/**
 * A coarse change of the current step: reasoning appeared, text started, a call changed or the
 * plan moved. Unlike the full signature, it ignores the growing text of a thought.
 */
export function lensStep(turns: AgentTurn[], phase: string, plan: PlanItem[]): string {
  const last = turns.at(-1);
  if (last?.role !== "assistant") return "";
  const thought = (last.parts ?? []).some((part) => part.type === "thought" && part.text.trim());
  // Only whether something runs, not which call: a tool change must not cost a request.
  const running = last.tools.some((tool) => tool.status === "running" && !tool.parent);
  return [
    thought ? "thought" : "",
    last.text.trim() ? "text" : "",
    running ? "running" : "",
    phase.trim(),
    plan.map((item) => item.status).join(","),
  ].join("|");
}

/** The live facts the model gets besides the conversation. */
export function lensState(
  turns: AgentTurn[],
  busy: boolean,
  phase: string,
  queue: QueuedMessage[],
  plan: PlanItem[],
): LensStateReport {
  const last = turns.at(-1);
  const running =
    last?.role === "assistant"
      ? last.tools
          .filter((tool) => tool.status === "running" && !tool.parent)
          .slice(-LENS_RUNNING_TOOLS)
          .map((tool) => ({
            name: tool.name,
            ...(tool.input ? { input: tool.input.slice(0, LENS_TOOL_INPUT) } : {}),
            ...(tool.startedAt ? { startedAt: tool.startedAt } : {}),
          }))
      : [];
  return {
    busy,
    ...(phase.trim() ? { phase: phase.trim() } : {}),
    running,
    plan: plan.map((item) => ({ content: item.content, status: item.status })),
    queue: queue.length,
  };
}

/**
 * What Lens would send right now: the timer asks only when this changes. The signature includes
 * the reasoning, text, calls and plan, so a repeated caption cannot describe the same step twice.
 */
export function lensSignature(
  turns: AgentTurn[],
  busy: boolean,
  phase: string,
  queue: QueuedMessage[],
  plan: PlanItem[],
): string {
  return JSON.stringify({
    history: lensHistory(turns),
    state: lensState(turns, busy, phase, queue, plan),
  });
}

/**
 * Lens of one chat: off until the user asks for it, then a short caption of the current work,
 * refreshed on a timer while the agent is busy and on demand. It is a read-only view: no chat
 * history, no run record, no session. Lives in memory only.
 */
export function useAgentLens(options: AgentLensOptions) {
  const state = reactive({
    open: false,
    text: "",
    at: 0,
    /** Ask again on a timer while the agent works. */
    auto: true,
    busy: false,
    error: "",
  });
  const interval = options.intervalMs ?? LENS_INTERVAL_MS;
  let generation = 0;
  let controller: AbortController | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  let stepTimer: ReturnType<typeof setTimeout> | undefined;
  /** The signature of the last successful request: an unchanged timer tick asks nothing. */
  let asked = "";
  /** A step change waits for the current request to finish instead of being lost. */
  let stepPending = false;

  function arm() {
    if (timer !== undefined) clearInterval(timer);
    timer = undefined;
    if (!state.open || !state.auto) {
      clearStep();
      return;
    }
    timer = setInterval(() => {
      if (!options.busy.value) return;
      if (typeof document !== "undefined" && document.hidden) return;
      void refresh(false);
    }, interval);
  }

  function disarm() {
    if (timer !== undefined) clearInterval(timer);
    timer = undefined;
    clearStep();
  }

  function clearStep() {
    stepPending = false;
    if (stepTimer !== undefined) clearTimeout(stepTimer);
    stepTimer = undefined;
  }

  function scheduleStep(delay = LENS_FIRST_DELAY_MS) {
    if (!state.open || !state.auto) return;
    stepPending = true;
    if (stepTimer !== undefined) clearTimeout(stepTimer);
    stepTimer = setTimeout(() => {
      stepTimer = undefined;
      void runStep();
    }, delay);
  }

  async function runStep() {
    if (!stepPending) return;
    if (!state.open || !state.auto || !options.busy.value) {
      stepPending = false;
      return;
    }
    if (state.busy) {
      stepTimer = setTimeout(() => {
        stepTimer = undefined;
        void runStep();
      }, LENS_RETRY_MS);
      return;
    }
    stepPending = false;
    await refresh(false);
  }

  /** Asks for a new caption; an in-flight request is replaced, and its answer dropped. */
  async function refresh(force = true): Promise<string> {
    if (!state.open || state.busy) return state.text;
    // The first seconds of a turn have no reasoning yet: a request here only earns "nothing
    // to describe". Keep the placeholder locally and wait for the first thought or call.
    if (options.busy.value && !lensHasMaterial(options.turns.value, options.plan.value)) {
      state.error = "";
      state.text = LENS_THINKING_TEXT;
      state.at = 0;
      return state.text;
    }
    const signature = lensSignature(
      options.turns.value,
      options.busy.value,
      options.phase.value,
      options.queue.value,
      options.plan.value,
    );
    if (!force && signature === asked) return state.text;
    const run = ++generation;
    controller?.abort();
    const next = new AbortController();
    controller = next;
    state.busy = true;
    state.error = "";
    try {
      const answer = await fetchLens(
        {
          history: lensHistory(options.turns.value),
          state: lensState(
            options.turns.value,
            options.busy.value,
            options.phase.value,
            options.queue.value,
            options.plan.value,
          ),
          selection: options.selection.value,
        },
        next.signal,
      );
      if (run !== generation) return state.text;
      state.text = answer.text;
      state.at = answer.at;
      asked = signature;
      return answer.text;
    } catch (error) {
      if (run === generation && !next.signal.aborted)
        state.error = error instanceof Error ? error.message : "Lens не удался";
      return state.text;
    } finally {
      if (run === generation) {
        state.busy = false;
        controller = undefined;
      }
    }
  }

  /** Turns Lens on (or refreshes it when already on) and resolves with the new caption. */
  async function open(): Promise<string> {
    if (!state.open) {
      state.open = true;
      state.error = "";
      arm();
    }
    return refresh();
  }

  function close() {
    state.open = false;
    generation++;
    controller?.abort();
    controller = undefined;
    state.busy = false;
    disarm();
  }

  function toggle() {
    if (state.open) close();
    else void open();
  }

  function setAuto(on: boolean) {
    state.auto = on;
    arm();
  }

  function clear() {
    state.text = "";
    state.at = 0;
    state.error = "";
    asked = "";
  }

  /** The feature is off, and the chat starts over. */
  function reset() {
    close();
    clear();
    state.auto = true;
  }

  function stop() {
    close();
  }

  // The first caption appears when the work starts, the last one sums the answer up.
  watch(options.busy, (busy) => {
    if (!state.open || !state.auto) return;
    if (busy) {
      clearStep();
      void refresh();
    } else if (Date.now() - state.at > 1_000) {
      clearStep();
      void refresh();
    }
  });
  // Reasoning, the first text or a new call is exactly when there is something to name. The
  // coarse step ignores the growing thought so Lens does not pay for a request per token.
  watch(
    () => lensStep(options.turns.value, options.phase.value, options.plan.value),
    () => {
      if (state.open && state.auto && options.busy.value) scheduleStep();
    },
  );
  // A cleared chat has no work to describe: the old caption cannot belong to it.
  watch(
    () => options.turns.value.length === 0,
    (empty) => {
      if (empty) reset();
    },
  );

  onScopeDispose(stop);

  return { state, open, close, toggle, setAuto, refresh, clear, reset, stop };
}

export type AgentLens = ReturnType<typeof useAgentLens>;

/** The chat's Lens as the workspace commands see it (see `ChatController`). */
export function lensActions(lens: AgentLens) {
  return {
    lensOpen: () => lens.state.open,
    openLens: () => lens.open(),
    closeLens: () => lens.close(),
    refreshLens: () => lens.refresh(),
    setLensAuto: (on: boolean) => lens.setAuto(on),
  };
}
