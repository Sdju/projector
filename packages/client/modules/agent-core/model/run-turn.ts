import { AgentRunGone } from "../api/client.ts";
import { findRejoinRun } from "../api/runs.ts";
import type { ChatState } from "./chat-state.ts";
import { INTERRUPTED } from "./load-history.ts";
import { previousSession } from "./session-tail.ts";
import {
  answerLooksOpen,
  markAnswerFailed,
  resetAnswer,
  restoreAnswer,
  snapshotAnswer,
} from "./turn-events.ts";
import type { AgentBackendId, AgentEvent, AgentTurn } from "./types.ts";

/** A restarting server answers again within seconds; this much patience covers a slow restart. */
const REJOIN_DELAY_MS = 1000;
const REJOIN_ATTEMPTS = 60;

/**
 * Streams one answer, rejoining the same run when the socket drops. A rejoin that gets no
 * events puts the previous visible answer back instead of saving an empty turn.
 */
export async function streamAnswer(
  assistant: AgentTurn,
  start: (
    onEvent: (event: AgentEvent) => void,
    signal: AbortSignal,
    attach?: string,
  ) => Promise<void>,
  onEvent: (event: AgentEvent) => void,
  signal: AbortSignal,
  firstAttach?: string,
): Promise<void> {
  let attach = firstAttach;
  for (let attempt = 0; ; attempt++) {
    const prior = snapshotAnswer(assistant);
    let got = false;
    if (attach) resetAnswer(assistant);
    try {
      await start(
        (event) => {
          got = true;
          onEvent(event);
        },
        signal,
        attach,
      );
      // Clean end (including Kimi soft keep-alive after end_turn): do not rejoin. Rejoin only
      // when the stream breaks while the answer is still open (restart / dropped socket).
      return;
    } catch (err) {
      if (!got) restoreAnswer(assistant, prior);
      if (err instanceof AgentRunGone || signal.aborted || !assistant.run) throw err;
      if (attempt >= REJOIN_ATTEMPTS) throw err;
    }
    await new Promise((resolve) => setTimeout(resolve, REJOIN_DELAY_MS));
    attach = assistant.run;
    if (signal.aborted || !attach) return;
  }
}

/** An empty turn failed only by transport/relay (no structured agent failure) can still be rejoined. */
export function rejoinableFailure(turn: AgentTurn): boolean {
  return (
    !!turn.failure && !turn.failureInfo && !turn.text.trim() && !turn.tools.length && !turn.stopped
  );
}

/** Finds a live or finished run on the server when the last assistant turn has none yet. */
export async function resolveRejoinRun(
  turns: AgentTurn[],
  assistant: AgentTurn,
  key: string,
  backend: AgentBackendId,
): Promise<string | undefined> {
  if (assistant.run || (!answerLooksOpen(assistant) && !rejoinableFailure(assistant)))
    return assistant.run;
  const sessionId = assistant.session?.id ?? previousSession(turns, assistant)?.id;
  return findRejoinRun(key, backend, assistant.at, sessionId);
}

/**
 * Streams an answer and falls back to rejoining/recovering when a relay or socket error broke
 * the response even though the server may already have started or finished the run.
 */
export async function streamOrRecoverAnswer(options: {
  state: ChatState;
  assistant: AgentTurn;
  key: string;
  backend: AgentBackendId;
  start: (
    onEvent: (event: AgentEvent) => void,
    signal: AbortSignal,
    attach?: string,
  ) => Promise<void>;
  onEvent: (event: AgentEvent) => void;
  signal: AbortSignal;
  firstAttach?: string;
  recover: (turn: AgentTurn | undefined) => Promise<boolean>;
}): Promise<void> {
  const { state, assistant, key, backend, start, onEvent, signal, firstAttach, recover } = options;
  try {
    await streamAnswer(assistant, start, onEvent, signal, firstAttach);
  } catch (err) {
    if (err instanceof AgentRunGone) {
      assistant.run = undefined;
      if (!(await recover(assistant)) && !assistant.text.trim()) assistant.text = INTERRUPTED;
      return;
    }
    if (signal.aborted) return;
    let failure: unknown = err;
    let recovered = false;
    if (!assistant.run && !assistant.failure && !assistant.text.trim() && !assistant.tools.length) {
      const sessionId = assistant.session?.id ?? previousSession(state.turns, assistant)?.id;
      const found = await findRejoinRun(key, backend, assistant.at, sessionId);
      if (found) {
        assistant.run = found;
        try {
          await streamAnswer(assistant, start, onEvent, signal, found);
          recovered = true;
        } catch (rejoinErr) {
          if (rejoinErr instanceof AgentRunGone) {
            assistant.run = undefined;
            if (!(await recover(assistant)) && !assistant.text.trim()) assistant.text = INTERRUPTED;
            recovered = true;
          } else {
            failure = rejoinErr;
          }
        }
      }
    }
    if (
      !recovered &&
      !signal.aborted &&
      !assistant.failure &&
      !assistant.text.trim() &&
      !assistant.tools.length
    ) {
      recovered = await recover(assistant);
    }
    if (recovered) state.error = "";
    else if (!signal.aborted) markAnswerFailed(state, assistant, failure);
  }
}
