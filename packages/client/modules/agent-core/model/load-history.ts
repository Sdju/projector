import { restoredQueue, savedQueue, type ChatState } from "./chat-state.ts";
import { normalizeRoleSnapshot } from "@ai-projector/core/modules/agent-role/index.ts";
import { applyRoleSnapshot } from "./role-apply.ts";

export const INTERRUPTED =
  "Ответ прерван: страница или сервер были перезапущены. Отправьте сообщение ещё раз — разговор продолжится.";

/** Fetches the saved conversation into the chat; `state.loading` holds until it is there. */
export function loadHistory(url: string, state: ChatState, quiet = false): Promise<void> {
  if (!quiet) state.loading = true;
  return fetch(url)
    .then(async (response) => {
      if (!response.ok) throw new Error("Не удалось загрузить историю чата");
      const data = await response.json();
      const features = Array.isArray(data.features) ? data.features : undefined;
      const judge = data.judge && typeof data.judge === "object" ? data.judge : undefined;
      const role = normalizeRoleSnapshot(data.role);
      const queue = restoredQueue(data.queue);
      // A refresh of an unchanged chat must not re-render it. A missing saved role is not a
      // change: a new chat gets its role from the tab before the first save. The tab's snapshot
      // is the same preset even when the saved copy is slightly older.
      const roleChanged =
        !!role && (!state.roleSnapshot || state.roleSnapshot.roleId !== role.roleId);
      if (
        quiet &&
        JSON.stringify(data.turns) === JSON.stringify(state.turns) &&
        JSON.stringify(features ?? null) === JSON.stringify(state.featureOverrides ?? null) &&
        JSON.stringify(judge ?? null) === JSON.stringify(state.judgeOverride ?? null) &&
        JSON.stringify(queue) === JSON.stringify(savedQueue(state.queue)) &&
        !roleChanged
      )
        return;
      state.turns = data.turns;
      state.queue = queue;
      state.featureOverrides = features;
      state.judgeOverride = judge;
      // The tab's snapshot is the same preset; do not overwrite a control changed in this chat
      // with a save that has not reached the server yet.
      if (role && (!state.roleSnapshot || state.roleSnapshot.roleId !== role.roleId))
        applyRoleSnapshot(state, role, true);
      // A turn saved at its start but never finished: the page or server went away mid-answer.
      // One with a live agent process behind it is rejoined instead (`resumeRun`).
      const last = state.turns.at(-1);
      // A failed answer keeps its reason and offers retry: it is not an interrupted one.
      if (
        last?.role === "assistant" &&
        !last.run &&
        !last.failure &&
        !last.text.trim() &&
        !last.tools.length
      )
        last.text = INTERRUPTED;
      // Without a live agent process behind the chat nothing reports any more: a task still shown
      // as running was cut off with its process (older chats kept such rows forever).
      if (!last?.run)
        for (const turn of state.turns)
          for (const task of turn.tasks ?? [])
            if (task.status === "running") {
              task.status = "stopped";
              task.summary ??= "Процесс агента завершился до отчёта о задаче";
            }
      for (const turn of state.turns)
        for (const chip of turn.tools) {
          if (chip.status === "running") {
            chip.status = "error";
            chip.detail = "Выполнение прервано";
          }
        }
    })
    .catch((error) => {
      if (!quiet) state.error = error.message;
    })
    .finally(() => {
      if (!quiet) state.loading = false;
    });
}
