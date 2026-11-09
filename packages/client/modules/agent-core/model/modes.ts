import { computed, reactive } from "vue";
import {
  clientAgentByBackend,
  clientAgentOf,
  clientAgents,
  type ClientAgent,
} from "../../agents-integration/catalog/index.ts";

export type AgentSessionMode = "tui" | "gui";

/** External agents that have a graphical chat, in catalog order. */
export const guiAgents = (): ClientAgent[] => clientAgents().filter((agent) => !agent.builtin);

/** The IDE command that opens the graphical chat of a terminal program. */
export const guiCommand = (program: string): string => `ide.workbench.${program}.open`;

/** Whether a terminal program has a graphical chat of its own. */
export const hasGui = (program: string): boolean => !!clientAgentOf(program);

/** The built-in Projector agent, if it is registered. */
export const builtinAgent = (): ClientAgent | undefined =>
  clientAgents().find((agent) => agent.builtin);

/** The server's own agent: it has no external session, project copy or separate chat tab. */
export const isBuiltinAgent = (backend: string | undefined): boolean =>
  clientAgentByBackend(backend ?? "")?.builtin === true;

/** Chat header and welcome copy for a backend. */
export function agentLabel(backend: string | undefined): string {
  return clientAgentByBackend(backend ?? "projector")?.title ?? "Агент";
}

const state = reactive({
  modes: {} as Record<string, AgentSessionMode>,
  /** Chat backends switched off in the settings, by backend id. */
  disabled: [] as string[],
  loaded: false,
  error: "",
});
let loading: Promise<void> | undefined;

async function request(init?: RequestInit): Promise<void> {
  const response = await fetch("/api/agent/modes", {
    ...init,
    headers: { "Content-Type": "application/json" },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Не удалось получить настройки агентов");
  state.modes = data.modes ?? {};
  state.disabled = Array.isArray(data.disabled) ? data.disabled : [];
  state.loaded = true;
}

/** How new agent sessions open. The default is the terminal; the choice is stored on disk. */
export function useAgentModes() {
  loading ??= request().catch((error) => {
    state.error = error.message;
    loading = undefined;
  });
  const modeOf = (program: string): AgentSessionMode =>
    hasGui(program) && state.modes[program] === "gui" ? "gui" : "tui";
  async function setMode(program: string, mode: AgentSessionMode): Promise<void> {
    const previous = state.modes[program];
    state.modes = { ...state.modes, [program]: mode };
    try {
      await request({ method: "PUT", body: JSON.stringify({ program, mode }) });
      state.error = "";
    } catch (error) {
      state.modes = { ...state.modes, [program]: previous ?? "tui" };
      state.error = error instanceof Error ? error.message : "Не удалось сохранить режим";
    }
  }
  /** A program without a chat of its own (Shell) is always enabled. */
  const isEnabled = (program: string): boolean => {
    const backend = clientAgentOf(program)?.backend;
    return !backend || !state.disabled.includes(backend);
  };
  async function setEnabled(program: string, enabled: boolean): Promise<void> {
    const backend = clientAgentOf(program)?.backend ?? program;
    const previous = state.disabled;
    state.disabled = enabled
      ? previous.filter((id) => id !== backend)
      : [...previous.filter((id) => id !== backend), backend];
    try {
      const response = await fetch("/api/agent/integrations", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ backend, enabled }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Не удалось сохранить интеграцию");
      state.disabled = Array.isArray(data.disabled) ? data.disabled : state.disabled;
      state.error = "";
    } catch (error) {
      state.disabled = previous;
      state.error = error instanceof Error ? error.message : "Не удалось сохранить интеграцию";
      throw error;
    }
  }
  return {
    modeOf,
    setMode,
    isEnabled,
    setEnabled,
    loaded: computed(() => state.loaded),
    error: computed(() => state.error),
  };
}
