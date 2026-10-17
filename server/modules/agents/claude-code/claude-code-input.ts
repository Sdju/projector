import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";

/** After a result, how long the input stays open for the next answer to start before it closes. */
const SETTLE_MS = 1500;

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
  const finish = () => {
    clearTimeout(timer);
    ended = true;
    wake?.();
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
      clearTimeout(timer);
    },
    /** A result arrived: the input closes unless the agent goes on to answer something more. */
    settled() {
      clearTimeout(timer);
      if (!queue.length) timer = setTimeout(finish, SETTLE_MS);
    },
    close: finish,
  };
}
