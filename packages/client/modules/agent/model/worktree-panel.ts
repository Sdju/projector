import { computed, ref, watch, type Ref } from "vue";
import type { WorktreeInfo } from "../api/client.ts";
import type { AgentTurn } from "./types.ts";

/** The isolated copy a chat works in: what it changed, and what the user did with it last. */
export function useWorktreePanel(
  turns: Ref<AgentTurn[]>,
  busy: Ref<boolean>,
  copyActions: {
    worktreeInfo: () => Promise<WorktreeInfo | undefined>;
    mergeCopy: () => Promise<string>;
    discardCopy: () => Promise<void>;
  },
) {
  const copy = computed(() => {
    void turns.value.length;
    return turns.value.findLast((turn) => turn.role === "assistant" && turn.worktree)?.worktree;
  });
  const copyInfo = ref<WorktreeInfo>();
  const copyWorking = ref(false);
  const copyNote = ref("");

  async function refreshCopy() {
    try {
      copyInfo.value = copy.value ? await copyActions.worktreeInfo() : undefined;
    } catch {
      copyInfo.value = undefined;
    }
  }
  watch([() => copy.value?.id, busy], refreshCopy, { immediate: true });

  async function endCopy(action: () => Promise<string | void>) {
    copyWorking.value = true;
    try {
      copyNote.value = (await action()) ?? "";
    } catch (cause) {
      copyNote.value = cause instanceof Error ? cause.message : "Не удалось выполнить";
    } finally {
      copyWorking.value = false;
    }
  }

  return { copy, copyInfo, copyWorking, copyNote, endCopy };
}
