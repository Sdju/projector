import { AgentRunGone } from "../api/client.ts";
import { resetAnswer, restoreAnswer, snapshotAnswer } from "./turn-events.ts";
import type { AgentEvent, AgentTurn } from "./types.ts";

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
