import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import type {
  DevcontainerDecision,
  DevcontainerState,
} from "../../../core/modules/devcontainer/index.ts";
import { useCommandScope } from "../../common/utilities/commands.ts";
import { decideDevcontainer, fetchDevcontainer } from "./client.ts";

/**
 * Trust state of the project's devcontainer.json. Granting or revoking trust is
 * deliberately not a command: it must be a user's click, not something the agent can run.
 */
export function useDevcontainer(projectId: string) {
  const state = ref<DevcontainerState>();
  const error = ref("");
  const busy = ref(false);
  const open = ref(false);
  let disposed = false;
  const commands = useCommandScope(`devcontainer:${projectId}`, () => ({
    surface: "devcontainer",
    projectId,
    found: state.value?.found ?? false,
    decision: state.value?.decision ?? null,
  }));
  async function refresh() {
    try {
      const next = await fetchDevcontainer(projectId);
      if (disposed) return next;
      state.value = next;
      error.value = "";
      return next;
    } catch (err) {
      if (!disposed) error.value = err instanceof Error ? err.message : "Ошибка Dev Container";
      throw err;
    }
  }
  async function decide(decision: DevcontainerDecision | "forget") {
    if (busy.value) return;
    busy.value = true;
    try {
      state.value = await decideDevcontainer(projectId, decision, state.value?.hash);
      error.value = "";
      open.value = false;
    } catch (err) {
      error.value = err instanceof Error ? err.message : "Ошибка Dev Container";
      // The config may have changed under the dialog: show the fresh one.
      await refresh().catch(() => undefined);
    } finally {
      busy.value = false;
    }
  }
  commands.scope.registerCommand({
    id: "ide.devcontainer.status",
    title: "Состояние Dev Container",
    description:
      "Возвращает найденный devcontainer.json, запрашиваемые им полномочия (findings), решение о доверии и признак устаревшего решения. Доверие может выдать только пользователь в окне.",
    run: refresh,
  });
  commands.scope.registerCommand({
    id: "ide.devcontainer.review",
    title: "Проверить доверие к Dev Container",
    description:
      "Открывает окно с полномочиями из devcontainer.json, где пользователь сам решает, доверять ли репозиторию. Решение не принимается автоматически.",
    enabled: () => !!state.value?.found,
    run: async () => {
      await refresh();
      open.value = true;
    },
  });
  onMounted(async () => {
    const next = await refresh().catch(() => undefined);
    if (next?.needsDecision) open.value = true;
  });
  onBeforeUnmount(() => {
    disposed = true;
  });
  return { state, error, busy, open, decide, refresh, visible: computed(() => open.value && !!state.value?.found) };
}
