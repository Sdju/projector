import {
  extendPlainDialect,
  inputOf,
  isOver,
  type AcpDialect,
  type AcpTaskPatch,
  type AcpUpdate,
} from "./acp-dialect.ts";

/**
 * Codex reports a subagent as two calls, "Start subagent <name>" and "Complete subagent <name>",
 * tied by `rawInput.agentThreadId` (nothing the subagent does is shown). A command in a terminal
 * keeps its call open until the process exits and streams its output as
 * `_meta.terminal_output_delta` chunks instead of putting it into the final update.
 */
function subagentOf(update: AcpUpdate) {
  const { agentThreadId, agentPath, activityKind } = inputOf(update);
  if (typeof agentThreadId !== "string") return undefined;
  const fromTitle = String(update.title ?? "").replace(/^(Start|Complete) subagent\s*/i, "");
  const name =
    fromTitle ||
    String(agentPath ?? "")
      .split("/")
      .at(-1) ||
    "subagent";
  return { id: agentThreadId, name, completed: activityKind === "completed" };
}

function terminalOf(update: AcpUpdate) {
  const content = Array.isArray(update.content) ? update.content : [];
  const hasTerminal = content.some((item) => (item as { type?: string })?.type === "terminal");
  const { command } = inputOf(update);
  return update.kind === "execute" && hasTerminal && typeof command === "string"
    ? command
    : undefined;
}

function deltaOf(update: AcpUpdate): string {
  const meta = update._meta as { terminal_output_delta?: { data?: unknown } } | undefined;
  const data = meta?.terminal_output_delta?.data;
  return typeof data === "string" ? data : "";
}

export function createCodexDialect(): AcpDialect {
  const started = new Set<string>();
  const streamed = new Map<string, string>();
  /** Terminal commands that have not ended, and the ones already shown as tasks. */
  const running = new Map<string, string>();
  const detached = new Set<string>();

  /**
   * A terminal command still open while the agent moves on (it spoke, or the answer ended) runs in
   * the background; its end is unknown once the answer is over.
   */
  function detach(): AcpTaskPatch[] {
    const patches: AcpTaskPatch[] = [];
    for (const [id, command] of running) {
      if (detached.has(id)) continue;
      detached.add(id);
      patches.push({
        id,
        kind: "shell",
        title: command,
        status: "running",
        background: true,
        untracked: true,
        tool: id,
      });
    }
    return patches;
  }

  return extendPlainDialect({
    call(update, id) {
      const delta = deltaOf(update);
      if (delta) streamed.set(id, (streamed.get(id) ?? "") + delta);
      const patches: AcpTaskPatch[] = [];
      const agent = subagentOf(update);
      if (agent?.completed) patches.push({ id: agent.id, status: "done" });
      else if (agent && !started.has(agent.id)) {
        started.add(agent.id);
        patches.push({
          id: agent.id,
          kind: "agent",
          title: agent.name,
          status: "running",
          background: false,
          tool: id,
        });
      }
      const command = terminalOf(update);
      if (command && !isOver(update)) running.set(id, command);
      return patches;
    },
    output(id) {
      const output = streamed.get(id) ?? "";
      streamed.delete(id);
      return output;
    },
    end(update, id) {
      running.delete(id);
      return detached.delete(id)
        ? [{ id, status: update.status === "failed" ? "error" : "done" }]
        : [];
    },
    speak: detach,
    finish: detach,
  });
}
