import type { AgentEvent } from "./types.ts";

/** How often streamed progress is written while an answer runs. */
const STREAM_SAVE_MS = 1_000;
/** Events that change the visible answer but do not have to be saved one by one. */
const STREAMING = new Set(["text", "thought", "tool", "tool-result", "task"]);

/**
 * Saves the answer while it streams, at most once per second. Structural events persist at once;
 * this catches the text and tool progress that would otherwise wait for the end of the answer.
 */
export function createStreamSaver(save: () => void) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return {
    /** Saves now when the event changed the saved shape, or after the delay for streamed output. */
    event(event: AgentEvent, immediate: boolean) {
      if (immediate) {
        if (timer !== undefined) {
          clearTimeout(timer);
          timer = undefined;
        }
        save();
        return;
      }
      if (!STREAMING.has(event.event) || timer !== undefined) return;
      timer = setTimeout(() => {
        timer = undefined;
        save();
      }, STREAM_SAVE_MS);
    },
    stop() {
      if (timer === undefined) return;
      clearTimeout(timer);
      timer = undefined;
    },
  };
}
