import { nextTick, ref } from "vue";
import type { RewindSummary } from "../api/client.ts";
import type { RewindScope } from "./types.ts";

/**
 * The panel that rolls the chat back to a message: it asks what to undo, shows what the files
 * would change, then does it. `rewindTo` is also what `ide.agent.chat.rewind` runs.
 */
export function useRewindPanel(chat: {
  rewindFiles: (id: string, dryRun: boolean) => Promise<RewindSummary>;
  edit: (id: string) => void;
  focus: () => void;
}) {
  const rewinding = ref<{ id: string; scope: RewindScope } | null>(null);
  const rewindPreview = ref<RewindSummary>();
  const rewindPreviewError = ref("");
  const rewindResult = ref<RewindSummary>();
  const rewindWorking = ref(false);

  function askRewind(id: string, scope: RewindScope = "conversation") {
    rewinding.value = { id, scope };
    rewindPreview.value = undefined;
    rewindPreviewError.value = "";
    rewindResult.value = undefined;
  }

  async function previewRewind(scope: RewindScope) {
    const target = rewinding.value;
    if (!target) return;
    target.scope = scope;
    if (scope === "conversation" || rewindPreview.value || rewindPreviewError.value) return;
    try {
      rewindPreview.value = await chat.rewindFiles(target.id, true);
    } catch (cause) {
      rewindPreviewError.value =
        cause instanceof Error ? cause.message : "Не удалось посчитать откат";
    }
  }

  async function rewindTo(id: string, scope: RewindScope): Promise<RewindSummary | undefined> {
    let result: RewindSummary | undefined;
    if (scope !== "conversation") result = await chat.rewindFiles(id, false);
    if (scope !== "files" && (!result || result.ok)) chat.edit(id);
    return result;
  }

  async function confirmRewind(scope: RewindScope) {
    const target = rewinding.value;
    if (!target || rewindWorking.value) return;
    rewindWorking.value = true;
    try {
      const result = await rewindTo(target.id, scope);
      // A real rewind reports no file list; the preview already told which files it changes.
      if (result)
        rewindResult.value = {
          ...result,
          files: result.files.length ? result.files : (rewindPreview.value?.files ?? []),
        };
      else rewinding.value = null;
      if (scope !== "files") await nextTick();
      chat.focus();
    } catch (cause) {
      rewindResult.value = {
        ok: false,
        files: [],
        error: cause instanceof Error ? cause.message : "Не удалось откатить",
      };
    } finally {
      rewindWorking.value = false;
    }
  }

  function closeRewind() {
    rewinding.value = null;
    rewindResult.value = undefined;
  }

  return {
    rewinding,
    rewindPreview,
    rewindPreviewError,
    rewindResult,
    rewindWorking,
    askRewind,
    previewRewind,
    rewindTo,
    confirmRewind,
    closeRewind,
  };
}
