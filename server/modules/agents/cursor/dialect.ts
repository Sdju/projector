import {
  extendPlainDialect,
  inputOf,
  type AcpDialect,
  type AcpTaskPatch,
  type AcpUpdate,
} from "../acp/index.ts";

function parentOf(update: AcpUpdate): string | undefined {
  const meta = (update._meta ?? {}) as Record<string, unknown>;
  for (const value of [update.parentToolCallId, meta.parentToolCallId, meta.parent])
    if (typeof value === "string" && value.trim()) return value;
  return undefined;
}

function subagentOf(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim() && value !== "unspecified") return value;
  if (value && typeof value === "object" && "custom" in value) {
    const custom = (value as { custom?: unknown }).custom;
    if (typeof custom === "string" && custom.trim()) return custom;
  }
  return undefined;
}

function taskOf(update: AcpUpdate) {
  const input = inputOf(update);
  const subagent = subagentOf(input.subagentType);
  const description = typeof input.description === "string" ? input.description.trim() : "";
  const prompt = typeof input.prompt === "string" ? input.prompt.trim() : "";
  if (!subagent && !description) return undefined;
  return {
    title: description || subagent || "задача",
    ...(subagent ? { subagent } : {}),
    ...(prompt ? { prompt } : {}),
  };
}

/** Nested calls and `task` tools become the chat's task list; Lens reads the child from there. */
export function createCursorDialect(): AcpDialect {
  const started = new Set<string>();

  return extendPlainDialect({
    tool(update) {
      const parent = parentOf(update);
      return {
        name: String(update.title || update.kind || "tool"),
        ...(parent ? { parent } : {}),
      };
    },
    inner: (update) => parentOf(update) !== undefined,
    call(update, id) {
      const patches: AcpTaskPatch[] = [];
      const task = taskOf(update);
      if (task && !started.has(id) && update.sessionUpdate === "tool_call") {
        started.add(id);
        patches.push({
          id,
          kind: "agent",
          title: task.title,
          status: "running",
          background: false,
          tool: id,
          ...(task.subagent ? { subagent: task.subagent } : {}),
          ...(task.prompt ? { prompt: task.prompt } : {}),
        });
      }
      const parent = parentOf(update);
      if (parent && update.sessionUpdate === "tool_call")
        patches.push({ id: parent, lastTool: String(update.title || update.kind || "tool") });
      return patches;
    },
  });
}
