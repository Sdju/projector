import { announceChat } from "./chat-sync.ts";
import { queued, saves, type ChatState } from "./chat-state.ts";

/**
 * Saves the chat to the server. Events arrive far faster than a save takes: saves queued behind
 * the running one collapse into a single request carrying the newest state.
 */
export function saveChat(key: string, url: string, state: ChatState) {
  if (queued.has(key)) return;
  queued.add(key);
  const saving = (saves.get(key) ?? Promise.resolve())
    .catch(() => {})
    .then(async () => {
      queued.delete(key);
      const response = await fetch(url, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ turns: state.turns }),
      });
      if (!response.ok) {
        const detail = await response.json().then(
          (data) => (typeof data?.error === "string" ? `: ${data.error}` : ""),
          () => "",
        );
        throw new Error(`Не удалось сохранить историю чата${detail}`);
      }
      announceChat(key);
    });
  saves.set(key, saving);
  void saving.catch((error) => {
    state.error = error.message;
  });
}
