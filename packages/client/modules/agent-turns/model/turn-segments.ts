import {
  legacyParts,
  type AgentToolChip,
  type AgentTurn,
  type AgentWorkItem,
} from "../../agent-core/index.ts";

type Segment =
  | { key: string; type: "text"; text: string }
  | { key: string; type: "note"; text: string }
  | { key: string; type: "work"; items: AgentWorkItem[] };

// Text, notes and work in the order they happened; thoughts and calls between texts form one
// collapsed "Работа" group, with neighbouring calls shown as one row inside it.
export function segmentsOf(turn: AgentTurn) {
  const result: Segment[] = [];
  // Calls a subagent made are shown inside its own call, not among the main ones.
  const known = new Set(turn.tools.map((tool) => tool.id));
  const children = new Map<string, AgentToolChip[]>();
  for (const tool of turn.tools)
    if (tool.parent && known.has(tool.parent))
      children.set(tool.parent, [...(children.get(tool.parent) ?? []), tool]);
  // A task call names the agent and model that work inside it, as the task event reported them.
  const startedTasks = new Map(
    (turn.tasks ?? []).flatMap((task) => (task.tool ? [[task.tool, task] as const] : [])),
  );
  const byId = new Map(
    turn.tools
      .filter((tool) => !tool.parent || !known.has(tool.parent))
      .map((tool) => [
        tool.id,
        {
          ...tool,
          children: children.get(tool.id),
          ...(startedTasks.has(tool.id) ? { task: startedTasks.get(tool.id) } : {}),
        },
      ]),
  );
  const addWork = (index: number, item: AgentWorkItem) => {
    const last = result.at(-1);
    if (last?.type === "work") last.items.push(item);
    else result.push({ key: `w${index}`, type: "work", items: [item] });
  };
  for (const [index, part] of (turn.parts ?? legacyParts(turn)).entries()) {
    if (part.type === "text") {
      if (part.text.trim()) result.push({ key: `t${index}`, type: "text", text: part.text });
      continue;
    }
    if (part.type === "note") {
      result.push({ key: `n${index}`, type: "note", text: part.text });
      continue;
    }
    if (part.type === "thought") {
      if (part.text.trim()) addWork(index, { key: `r${index}`, type: "thought", text: part.text });
      continue;
    }
    if (part.type === "judge") {
      addWork(index, {
        key: `j${index}`,
        type: "judge",
        tool: part.tool,
        ...(part.title ? { title: part.title } : {}),
        verdict: part.verdict,
        decision: part.decision,
      });
      continue;
    }
    const tool = byId.get(part.id);
    if (!tool) continue;
    const last = result.at(-1);
    if (last?.type === "work") {
      const item = last.items.at(-1);
      if (item?.type === "tools") {
        item.tools.push(tool);
        continue;
      }
    }
    addWork(index, { key: `a${index}`, type: "tools", tools: [tool] });
  }
  return result;
}
