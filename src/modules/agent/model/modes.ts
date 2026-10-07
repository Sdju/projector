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
  if (!response.ok) throw new Error(data.error || "Не удалось получить режимы сессий");
  state.modes = data.modes ?? {};
  state.loaded = true;
}

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
  return { modeOf, setMode, error: computed(() => state.error) };
}
