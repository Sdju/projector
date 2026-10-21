import { getCurrentScope, onScopeDispose } from "vue";

/**
 * Other pages of the same origin learn that a chat was saved: an answer started in one page
 * is then rejoined in the others instead of staying cut off at the history they loaded.
 */
const channel =
  typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel("projector:agent-chat");
const listeners = new Map<string, Set<() => void>>();

channel?.addEventListener("message", ({ data }) => {
  if (typeof data?.key !== "string") return;
  for (const listener of listeners.get(data.key) ?? []) listener();
});
import.meta.hot?.dispose(() => channel?.close());

export function announceChat(key: string): void {
  channel?.postMessage({ key });
}

/**
 * Runs `sync` when another page saved the chat or this page becomes visible again, never twice
 * at once and not while `skip()` (the page is itself answering or saving: it is the newer writer).
 */
export function watchChat(key: string, skip: () => boolean, sync: () => Promise<void>): void {
  let syncing = false;
  const refresh = () => {
    if (syncing || skip()) return;
    syncing = true;
    void sync().finally(() => {
      syncing = false;
    });
  };
  const set = listeners.get(key) ?? new Set();
  listeners.set(key, set);
  set.add(refresh);
  const visible = () => {
    if (document.visibilityState === "visible") refresh();
  };
  document.addEventListener("visibilitychange", visible);
  if (getCurrentScope())
    onScopeDispose(() => {
      set.delete(refresh);
      document.removeEventListener("visibilitychange", visible);
    });
}
