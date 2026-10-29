import { computed, reactive } from "vue";

export type AgentSessionMode = "tui" | "gui";

/** Terminal programs with a graphical chat and the IDE command that opens it. */
export const guiPrograms: Record<string, { title: string; command: string }> = {
  claude: { title: "Claude Code", command: "ide.workbench.claude.open" },
  codex: { title: "Codex", command: "ide.workbench.codex.open" },
  opencode: { title: "OpenCode", command: "ide.workbench.opencode.open" },
  cursor: { title: "Cursor", command: "ide.workbench.cursor.open" },
};

/** Chat header and welcome copy for each backend. */
const agentLabels: Record<string, string> = {
  projector: "Projector",
  "claude-code": "Claude Code",
  codex: "Codex",
  opencode: "OpenCode",
  cursor: "Cursor",
};

export function agentLabel(backend: string | undefined): string {
  return agentLabels[backend ?? "projector"] ?? "Агент";
}

const state = reactive({
  modes: {} as Record<string, AgentSessionMode>,
  /** Chat backends switched off in the settings, by backend id (`claude-code`, `codex`, …). */
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

/** The chat backend behind a terminal program; only Claude Code's names differ. */
export const programBackend = (program: string): string =>
  program === "claude" ? "claude-code" : program;

/** How new agent sessions open. The default is the terminal; the choice is stored on disk. */
export function useAgentModes() {
  loading ??= request().catch((error) => {
    state.error = error.message;
    loading = undefined;
  });
  const modeOf = (program: string): AgentSessionMode =>
    guiPrograms[program] && state.modes[program] === "gui" ? "gui" : "tui";
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
  const isEnabled = (program: string): boolean =>
    !guiPrograms[program] || !state.disabled.includes(programBackend(program));
  async function setEnabled(program: string, enabled: boolean): Promise<void> {
    const backend = programBackend(program);
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
