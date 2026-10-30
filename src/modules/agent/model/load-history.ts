import type { ChatState } from "./chat-state.ts";

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
      // A refresh of an unchanged chat must not re-render it.
      if (
        quiet &&
        JSON.stringify(data.turns) === JSON.stringify(state.turns) &&
        JSON.stringify(features ?? null) === JSON.stringify(state.featureOverrides ?? null)
      )
        return;
      state.turns = data.turns;
      state.featureOverrides = features;
      // A turn saved at its start but never finished: the page or server went away mid-answer.
      // One with a live agent process behind it is rejoined instead (`resumeRun`).
      const last = state.turns.at(-1);
      if (last?.role === "assistant" && !last.run && !last.text.trim() && !last.tools.length)
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
