import type { AcpDialect, AcpTaskPatch, AcpUpdate, PluginCodeApi } from "./api.ts";

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

function toolNameOf(update: AcpUpdate): string {
  const title = typeof update.title === "string" ? update.title : "";
  const kind = typeof update.kind === "string" ? update.kind : "";
  return title || kind || "tool";
}

/** Nested calls and `task` tools become the chat's task list; Lens reads the child from there. */
export function createCursorDialect(api: PluginCodeApi): AcpDialect {
  const { extendPlainDialect, inputOf } = api.acp;
  const started = new Set<string>();

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

  return extendPlainDialect({
    tool(update) {
      const parent = parentOf(update);
      return {
        name: toolNameOf(update),
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
        patches.push({ id: parent, lastTool: toolNameOf(update) });
      return patches;
    },
  });
}
