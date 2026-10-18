import type { ChatState } from "./chat-state.ts";

export const INTERRUPTED =
  "Ответ прерван: страница или сервер были перезапущены. Отправьте сообщение ещё раз — разговор продолжится.";

/** Fetches the saved conversation into the chat; `state.loading` holds until it is there. */
export function loadHistory(url: string, state: ChatState): Promise<void> {
  state.loading = true;
  return fetch(url)
    .then(async (response) => {
      if (!response.ok) throw new Error("Не удалось загрузить историю чата");
      const data = await response.json();
      state.turns = data.turns;
      // A turn saved at its start but never finished: the page or server went away mid-answer.
      // One with a live agent process behind it is rejoined instead (`resumeRun`).
      const last = state.turns.at(-1);
      if (last?.role === "assistant" && !last.run && !last.text.trim() && !last.tools.length)
        last.text = INTERRUPTED;
      for (const turn of state.turns)
        for (const chip of turn.tools) {
          if (chip.status === "running") {
            chip.status = "error";
            chip.detail = "Выполнение прервано";
          }
        }
    })
    .catch((error) => {
      state.error = error.message;
    })
    .finally(() => {
      state.loading = false;
    });
}
