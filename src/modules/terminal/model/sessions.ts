import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { TerminalProgram, TerminalSession } from "../../../../core/modules/terminal/index.ts";
import { TerminalRequestError, terminalRequest, subscribeTerminalSessions } from "../lib/api.ts";

export interface TerminalSessionHooks {
  enabled?: boolean;
  /** Процесс проекта открыл терминал: его нужно показать. */
  started?: (sessionId: string) => void;
  /** Перезапуск создаёт новую сессию на месте прежней. */
  restarted?: (previousId: string, sessionId: string) => void;
}

/**
 * Список терминальных сессий проекта и действия над ними. Сам экран терминала живёт в
 * `TerminalView`, поэтому сессии можно раскладывать по блокам независимо друг от друга.
 */
export function useTerminalSessions(projectId: () => string, hooks: TerminalSessionHooks = {}) {
  const sessions = ref<TerminalSession[]>([]);
  const loaded = ref(false);
  const busy = ref(false);
  const error = ref("");
  const pendingClose = ref<TerminalSession | null>(null);
  const numbers = new Map<string, number>();
  let nextNumber = 1;
  let listGeneration = 0;
  let destroyed = false;
  let unsubscribe: (() => void) | undefined;
  let closeQueue: string[] = [];
  let pendingSessions: TerminalSession[] | undefined;

  function nameOf(session: TerminalSession): string {
    if (!numbers.has(session.id)) numbers.set(session.id, nextNumber++);
    return session.customTitle ?? `${session.title} ${numbers.get(session.id)}`;
  }
  const failed = (session: TerminalSession) =>
    session.status === "exited" && !session.stopRequested && session.exitCode !== 0;
  function labelOf(session: TerminalSession): string {
    const label = nameOf(session);
    if (session.status === "exited")
      return `${label} · ${failed(session) ? "ошибка" : "завершён"} · код ${session.exitCode ?? "—"}`;
    return session.stopRequested ? `${label} · завершаю` : label;
  }

  function replace(incoming: TerminalSession[]) {
    // A restart must swap its dock panel before a pushed list removes the old session.
    if (busy.value) {
      pendingSessions = incoming;
      return;
    }
    for (const session of incoming) nameOf(session);
    const order = new Map(sessions.value.map((session, index) => [session.id, index]));
    sessions.value = [...incoming].sort(
      (a, b) => (order.get(a.id) ?? Infinity) - (order.get(b.id) ?? Infinity),
    );
    loaded.value = true;
  }
  function update(session: TerminalSession) {
    const index = sessions.value.findIndex((item) => item.id === session.id);
    if (index !== -1) sessions.value[index] = session;
  }
  const current = (id: string) => !destroyed && id === projectId();

  async function refresh(): Promise<void> {
    if (hooks.enabled === false) {
      loaded.value = true;
      return;
    }
    const generation = ++listGeneration;
    const id = projectId();
    try {
      const data = await terminalRequest<{ sessions: TerminalSession[] }>(id);
      if (current(id) && generation === listGeneration) replace(data.sessions);
    } catch (err) {
      if (current(id))
        error.value = err instanceof Error ? err.message : "Не удалось загрузить терминалы";
    }
  }

  async function create(program: TerminalProgram): Promise<TerminalSession | undefined> {
    if (hooks.enabled === false) throw new Error("Терминалы недоступны для этого проекта");
    busy.value = true;
    error.value = "";
    const id = projectId();
    try {
      const data = await terminalRequest<{ session: TerminalSession }>(id, "", {
        method: "POST",
        body: JSON.stringify({ program, cols: 80, rows: 24 }),
      });
      if (!current(id)) return;
      nameOf(data.session);
      if (!sessions.value.some((session) => session.id === data.session.id))
        sessions.value.push(data.session);
      return data.session;
    } catch (err) {
      error.value = err instanceof Error ? err.message : "Не удалось открыть терминал";
    } finally {
      busy.value = false;
    }
  }

  async function rename(sessionId: string, title: string) {
    ++listGeneration;
    const id = projectId();
    error.value = "";
    try {
      const { session } = await terminalRequest<{ session: TerminalSession }>(
        id,
        `/${encodeURIComponent(sessionId)}`,
        { method: "POST", body: JSON.stringify({ action: "rename", title }) },
      );
      if (current(id)) {
        ++listGeneration;
        update(session);
      }
    } catch (err) {
      if (current(id))
        error.value = err instanceof Error ? err.message : "Не удалось переименовать терминал";
    }
  }

  async function action(sessionId: string, kind: "stop" | "restart"): Promise<void> {
    const previous = sessions.value.find((item) => item.id === sessionId);
    if (!previous || busy.value) return;
    ++listGeneration;
    const position = sessions.value.indexOf(previous);
    const id = projectId();
    busy.value = true;
    error.value = "";
    try {
      const data = await terminalRequest<{ session: TerminalSession }>(
        id,
        `/${encodeURIComponent(previous.id)}`,
        { method: "POST", body: JSON.stringify({ action: kind }) },
      );
      if (!current(id)) return;
      ++listGeneration;
      if (kind === "stop") {
        // An exit status may have arrived over the socket before this HTTP response.
        if (sessions.value.find((item) => item.id === previous.id)?.status !== "exited")
          update(data.session);
      } else {
        // The owner swaps the tab in place before the list changes, so the new tab keeps its block.
        hooks.restarted?.(previous.id, data.session.id);
        sessions.value = sessions.value.filter(
          (item) => item.id !== previous.id && item.id !== data.session.id,
        );
        sessions.value.splice(Math.min(position, sessions.value.length), 0, data.session);
        numbers.set(data.session.id, numbers.get(previous.id) ?? nextNumber++);
      }
    } catch (err) {
      if (current(id))
        error.value = err instanceof Error ? err.message : "Не удалось изменить сессию";
    } finally {
      busy.value = false;
    }
  }

  async function closeSession(sessionId: string, confirmation?: string): Promise<void> {
    if (busy.value) return;
    ++listGeneration;
    busy.value = true;
    error.value = "";
    const id = projectId();
    try {
      if (!confirmation) {
        const { session } = await terminalRequest<{ session: TerminalSession }>(
          id,
          `/${encodeURIComponent(sessionId)}`,
        );
        if (!current(id)) return;
        if (session.activity?.state !== "idle") {
          pendingClose.value = session;
          return;
        }
      }
      await terminalRequest(id, `/${encodeURIComponent(sessionId)}`, {
        method: "DELETE",
        body: JSON.stringify({ confirmation }),
      });
      if (!current(id)) return;
      ++listGeneration;
      pendingClose.value = null;
      sessions.value = sessions.value.filter((item) => item.id !== sessionId);
    } catch (err) {
      if (current(id)) {
        if (err instanceof TerminalRequestError && err.session) pendingClose.value = err.session;
        else error.value = err instanceof Error ? err.message : "Не удалось удалить сессию";
      }
    } finally {
      busy.value = false;
    }
  }

  async function drainCloseQueue() {
    while (closeQueue.length && !destroyed) {
      const id = closeQueue[0]!;
      if (sessions.value.some((session) => session.id === id)) {
        await closeSession(id);
        if (sessions.value.some((session) => session.id === id)) return;
      }
      closeQueue.shift();
    }
  }
  async function closeMany(ids: string[]) {
    closeQueue = [...ids];
    await drainCloseQueue();
  }
  const close = (sessionId: string) => closeMany([sessionId]);
  function cancelClose() {
    if (busy.value) return;
    closeQueue = [];
    pendingClose.value = null;
  }
  async function confirmClose() {
    const session = pendingClose.value;
    if (!session) return;
    await closeSession(session.id, session.activity?.confirmation);
    if (!sessions.value.some((item) => item.id === session.id)) await drainCloseQueue();
  }

  async function started(event: Event) {
    const detail = (event as CustomEvent<{ projectId: string; sessionId: string }>).detail;
    if (detail.projectId !== projectId()) return;
    await refresh();
    if (!destroyed && sessions.value.some((session) => session.id === detail.sessionId))
      hooks.started?.(detail.sessionId);
  }

  watch(
    busy,
    (value) => {
      if (value || !pendingSessions) return;
      const incoming = pendingSessions;
      pendingSessions = undefined;
      replace(incoming);
    },
    { flush: "sync" },
  );

  function reset() {
    pendingSessions = undefined;
    closeQueue = [];
    pendingClose.value = null;
    sessions.value = [];
    loaded.value = false;
    error.value = "";
    numbers.clear();
    nextNumber = 1;
    subscribe();
  }
  function subscribe() {
    unsubscribe?.();
    if (hooks.enabled === false) {
      loaded.value = true;
      return;
    }
    const id = projectId();
    unsubscribe = subscribeTerminalSessions(id, (incoming) => {
      if (!current(id)) return;
      ++listGeneration;
      replace(incoming);
    });
  }
  watch(projectId, reset);
  onMounted(() => {
    if (hooks.enabled === false) {
      loaded.value = true;
      return;
    }
    window.addEventListener("projector:terminal-started", started);
    subscribe();
  });
  onBeforeUnmount(() => {
    destroyed = true;
    unsubscribe?.();
    window.removeEventListener("projector:terminal-started", started);
  });

  return {
    sessions,
    loaded,
    busy,
    error,
    pendingClose,
    nameOf,
    labelOf,
    failed,
    replace,
    update,
    refresh,
    create,
    rename,
    stop: (id: string) => action(id, "stop"),
    restart: (id: string) => action(id, "restart"),
    close,
    closeMany,
    cancelClose,
    confirmClose,
  };
}
