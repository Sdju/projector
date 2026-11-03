import type { SDKMessage, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";

/** After a result, how long the input stays open for the next answer to start before it closes. */
const SETTLE_MS = 1500;
/** The longest the input stays open for background agents that have not reported. */
const HOLD_MAX_MS = 30 * 60_000;

/**
 * The input of one answer: the first message, then whatever the user adds while it runs (the SDK
 * takes those at once, ahead of the queue). The SDK may answer an added message in the same turn
 * or in the next one, so the input closes when a result is followed by silence.
 */
export function createInput(first: SDKUserMessage) {
  const queue: SDKUserMessage[] = [first];
  let wake: (() => void) | undefined;
  let ended = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let capTimer: ReturnType<typeof setTimeout> | undefined;
  let resulted = false;
  let holding = false;
  const finish = () => {
    clearTimeout(timer);
    clearTimeout(capTimer);
    ended = true;
    wake?.();
  };
  /** Closing ends the agent process and with it every subagent still working inside it. */
  const settle = () => {
    clearTimeout(timer);
    if (resulted && !holding && !queue.length) timer = setTimeout(finish, SETTLE_MS);
  };
  async function* stream(): AsyncGenerator<SDKUserMessage> {
    while (true) {
      const next = queue.shift();
      if (next) yield next;
      else if (ended) return;
      else await new Promise<void>((resolve) => (wake = resolve));
    }
  }
  return {
    stream: stream(),
    /** Adds a message to the running answer; `false` once the input is closed. */
    push(text: string): boolean {
      if (ended) return false;
      clearTimeout(timer);
      queue.push({
        type: "user",
        parent_tool_use_id: null,
        priority: "now",
        message: { role: "user", content: [{ type: "text", text }] },
      });
      wake?.();
      return true;
    },
    /** Something other than a result arrived: another answer has started. */
    busy() {
      resulted = false;
      clearTimeout(timer);
    },
    /**
     * Background agents still work (or no longer do). While they do, the input stays open: their
     * reports start a following answer in this process, and closing it would kill them.
     */
    hold(on: boolean) {
      if (on === holding) return;
      holding = on;
      if (on && !capTimer) capTimer = setTimeout(finish, HOLD_MAX_MS);
      if (!on) {
        clearTimeout(capTimer);
        capTimer = undefined;
      }
      settle();
    },
    /**
     * Keeps the input open while background agents work (`working` of them), and waits for the
     * answer their report starts instead of closing in the gap before it.
     */
    follow(message: SDKMessage, working: number) {
      this.hold(working > 0);
      if (
        message.type === "system" &&
        message.subtype === "task_notification" &&
        !message.skip_transcript &&
        !message.ambient
      )
        this.busy();
    },
    /** A result arrived: the input closes unless the agent goes on to answer something more. */
    settled() {
      resulted = true;
      settle();
    },
    close: finish,
  };
}
