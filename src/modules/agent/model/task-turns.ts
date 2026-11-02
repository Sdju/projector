import { onScopeDispose, ref, watch } from "vue";
import { loadSessionTurns } from "../api/client.ts";
import type { AgentBackendId, AgentTurn } from "./types.ts";

/**
 * The conversation of a subagent's own session, read from the agent. Nothing is loaded until
 * `start()`, so a task row can keep it closed without touching the agent; while it runs, the
 * conversation is read again on a timer.
 */
export function useTaskTurns(options: {
  backend: () => AgentBackendId | undefined;
  projectId: () => string | undefined;
  session: () => string | undefined;
  running: () => boolean;
  /** Read the session as soon as there is one, without an explicit `start()`. */
  auto?: boolean;
  intervalMs?: number;
}) {
  const turns = ref<AgentTurn[]>([]);
  const error = ref("");
  const active = ref(options.auto === true);
  const interval = options.intervalMs ?? 3_000;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let generation = 0;

  async function load(): Promise<void> {
    if (!active.value) return;
    clearTimeout(timer);
    timer = undefined;
    const backend = options.backend();
    const projectId = options.projectId();
    const session = options.session();
    if (!backend || !projectId || !session) return;
    const current = ++generation;
    try {
      const loaded = await loadSessionTurns(backend, projectId, session);
      if (current !== generation) return;
      turns.value = loaded;
      error.value = "";
    } catch (cause) {
      if (current === generation)
        error.value = cause instanceof Error ? cause.message : "Не удалось прочитать сессию";
    }
    if (current === generation && active.value && options.running())
      timer = setTimeout(() => void load(), interval);
  }

  /** Starts reading the session, and resolves with the first read. */
  async function start(): Promise<void> {
    active.value = true;
    await load();
  }

  /** Stops reading and drops the timer; the loaded turns stay for a finished task. */
  function stop(): void {
    active.value = false;
    generation++;
    clearTimeout(timer);
    timer = undefined;
  }

  watch(
    () => [options.session(), options.running()],
    () => {
      clearTimeout(timer);
      timer = undefined;
      void load();
    },
    { immediate: options.auto === true },
  );

  onScopeDispose(stop);

  return { turns, error, load, start, stop };
}
