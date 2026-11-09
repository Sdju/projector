import { computed, ref } from "vue";
import type { PlanItem } from "../../agent-core/index.ts";
import { toolLabel } from "../../agent-core/index.ts";
import { useAgentLens } from "./lens.ts";
import { useTaskTurns } from "./task-turns.ts";
import type {
  AgentBackendId,
  AgentSelection,
  AgentTurn,
  QueuedMessage,
} from "../../agent-core/index.ts";

/**
 * Lens and transcript of one subagent. Rows read the session only when opened and stop on close;
 * the task tab reads it immediately and keeps refreshing while the task runs.
 */
export function useTaskLens(options: {
  backend: () => AgentBackendId | undefined;
  projectId: () => string | undefined;
  session: () => string | undefined;
  running: () => boolean;
  lastTool: () => string | undefined;
  selection?: () => AgentSelection | undefined;
  /** Shown before the agent's session has any turns, e.g. the task assignment. */
  fallback?: () => { id: string; text: string } | undefined;
  /** Read the session as soon as it exists. */
  auto?: boolean;
  /** `start()` opens the session on demand; otherwise only an empty transcript is loaded. */
  startOnOpen?: boolean;
  /** Stop polling the transcript when Lens closes. */
  stopOnClose?: boolean;
}) {
  const transcript = useTaskTurns({
    backend: options.backend,
    projectId: options.projectId,
    session: options.session,
    running: options.running,
    auto: options.auto,
  });
  const turns = computed((): AgentTurn[] => {
    if (transcript.turns.value.length) return transcript.turns.value;
    const fallback = options.fallback?.();
    return fallback ? [{ id: fallback.id, role: "user", text: fallback.text, tools: [] }] : [];
  });
  const phase = computed(() => {
    if (!options.running()) return "";
    const tool = options.lastTool();
    return tool ? `выполняет ${toolLabel(tool)}` : "";
  });
  const lens = useAgentLens({
    turns,
    busy: computed(() => options.running()),
    phase,
    queue: ref<QueuedMessage[]>([]),
    plan: ref<PlanItem[]>([]),
    selection: computed(() => options.selection?.() ?? {}),
  });
  const lensNote = computed(
    () => lens.state.error || lens.state.text || (lens.state.busy ? "Смотрю, чем занят…" : ""),
  );

  async function toggleLens() {
    if (lens.state.open) {
      lens.close();
      if (options.stopOnClose) transcript.stop();
      return;
    }
    if (options.startOnOpen) await transcript.start();
    else if (!turns.value.length) await transcript.load();
    await lens.open();
  }

  return { lens, lensNote, turns, loadError: transcript.error, toggleLens };
}
