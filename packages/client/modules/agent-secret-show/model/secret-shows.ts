import { onBeforeUnmount, onMounted, ref } from "vue";

/** One secret a tool handed to the page; the value lives only in this open chat. */
export interface AgentSecretShowItem {
  id: string;
  secret: string;
  label: string;
  comment: string;
}

interface SecretShowEvent {
  id?: unknown;
  secret?: unknown;
  label?: unknown;
  comment?: unknown;
  projectId?: unknown;
}

const LIMIT = 32 * 1024;
const LIFETIME_MS = 5 * 60_000;

/**
 * Listens for `secret-show` events and keeps the ones for this project's active chat. A value
 * never enters the chat state, history or the agent's context: it is a live panel with a timeout.
 */
export function useSecretShows(projectId: string, active: () => boolean) {
  const shows = ref<AgentSecretShowItem[]>([]);
  const timers = new Map<string, ReturnType<typeof setTimeout>>();

  function dismiss(id: string): void {
    const timer = timers.get(id);
    if (timer !== undefined) clearTimeout(timer);
    timers.delete(id);
    shows.value = shows.value.filter((item) => item.id !== id);
  }

  function show(payload: SecretShowEvent): void {
    const target = typeof payload.projectId === "string" ? payload.projectId : "";
    if (target && target !== projectId) return;
    if (!active()) return;
    const secret = typeof payload.secret === "string" ? payload.secret : "";
    if (!secret || secret.length > LIMIT) return;
    const id =
      typeof payload.id === "string" && payload.id
        ? payload.id
        : globalThis.crypto?.randomUUID?.() || String(Date.now());
    const label = typeof payload.label === "string" ? payload.label.slice(0, 200) : "";
    const comment = typeof payload.comment === "string" ? payload.comment.slice(0, 1_000) : "";
    if (timers.has(id)) dismiss(id);
    shows.value.push({ id, secret, label, comment });
    timers.set(
      id,
      setTimeout(() => dismiss(id), LIFETIME_MS),
    );
  }

  const onShow = (event: Event) => {
    const detail = (event as CustomEvent<SecretShowEvent>).detail;
    if (detail && typeof detail === "object") show(detail);
  };

  onMounted(() => window.addEventListener("projector:secret-show", onShow));
  onBeforeUnmount(() => {
    window.removeEventListener("projector:secret-show", onShow);
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear();
  });

  return { shows, dismiss };
}
