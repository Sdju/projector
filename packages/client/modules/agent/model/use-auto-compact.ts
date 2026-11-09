import { watch, type Ref } from "vue";
import type { AgentCapabilities, AgentTurn, QueuedMessage } from "../../agent-core/index.ts";

/**
 * Compacts the chat after an answer once its context is nearly full, unless the user already asked
 * for it. The chat only offers the command when the backend supports compaction.
 */
export function useAutoCompact(options: {
  busy: Ref<boolean>;
  capabilities: Ref<AgentCapabilities>;
  contextShare: Ref<number>;
  queue: Ref<QueuedMessage[]>;
  turns: Ref<AgentTurn[]>;
  error: Ref<string>;
  send: (text?: string) => Promise<void>;
  toBottom: () => Promise<void>;
}) {
  watch(options.busy, (working) => {
    const policy = options.capabilities.value.compact;
    if (
      working ||
      !policy ||
      options.contextShare.value < policy.autoAt ||
      options.queue.value.length
    )
      return;
    if (options.turns.value.findLast((turn) => turn.role === "user")?.text === policy.command)
      return;
    if (options.error.value) return;
    void compact();
  });

  async function compact() {
    await options.toBottom();
    const policy = options.capabilities.value.compact;
    if (!policy) throw new Error("Агент не поддерживает сжатие разговора");
    await options.send(policy.command);
  }

  return { compact };
}
