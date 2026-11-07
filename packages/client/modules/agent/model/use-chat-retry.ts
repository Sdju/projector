import { computed, type Ref } from "vue";
import type { AgentTurn } from "./types.ts";

interface ChatRetry {
  /** The last answer failed: the same request can be sent again. */
  retryableError: Ref<boolean>;
  retryFailed: () => Promise<void>;
}

/**
 * The retry action of a failed last answer. Other errors in the same banner (saving the chat,
 * copying an answer) are not requests and must not repeat the message.
 */
export function useChatRetry(
  turns: Ref<AgentTurn[]>,
  busy: Ref<boolean>,
  error: Ref<string>,
  copyError: Ref<string>,
  retry: (id: string) => Promise<void>,
): ChatRetry {
  const failedTurn = computed(() => {
    const last = turns.value.at(-1);
    return last?.role === "assistant" && last.failure ? last : undefined;
  });
  const retryableError = computed(
    () =>
      !!failedTurn.value &&
      !copyError.value &&
      !busy.value &&
      error.value === failedTurn.value.failure,
  );
  async function retryFailed(): Promise<void> {
    const turn = failedTurn.value;
    if (turn) await retry(turn.id);
  }
  return { retryableError, retryFailed };
}
