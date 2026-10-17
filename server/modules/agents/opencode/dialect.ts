import {
  extendPlainDialect,
  inputOf,
  shorten,
  type AcpDialect,
  type AcpTaskPatch,
  type AcpUpdate,
} from "../acp/index.ts";

/**
 * OpenCode runs a subagent as a `subagent` tool call and marks everything the subagent does
 * (calls and messages) with the id and title of its child session in `_meta`. A command moved to
 * the background answers at once (`rawInput.background`) and never reports its end.
 */
interface ChildSession {
  id: string;
  title?: string;
}

function childOf(update: AcpUpdate): ChildSession | undefined {
  const meta = (update._meta as Record<string, unknown> | undefined)?.["opencode/child-session"];
  const { id, title } = (meta ?? {}) as { id?: unknown; title?: unknown };
  if (typeof id !== "string") {
    // Calls of a child session are also named after it: `<session id>:<call id>`.
    const session = /^(ses_[^:]+):/.exec(String(update.toolCallId ?? ""))?.[1];
    return session ? { id: session } : undefined;
  }
  return { id, ...(typeof title === "string" ? { title } : {}) };
}

/** The input of the call that starts a subagent; it arrives with a later update, not the first. */
function subagentOf(update: AcpUpdate) {
  const { agent, description, prompt } = inputOf(update);
  if (typeof agent !== "string") return undefined;
  return {
    agent,
    description: typeof description === "string" ? description : agent,
    ...(typeof prompt === "string" && prompt ? { prompt } : {}),
  };
}

/** The result of a subagent call wraps the subagent's answer in `<subagent ...>` tags. */
const unwrap = (text: string) => text.replace(/<\/?subagent[^>]*>/g, "");

function backgroundOf(update: AcpUpdate) {
  const { background, command } = inputOf(update);
  return background === true && typeof command === "string" ? command : undefined;
}

export function createOpencodeDialect(): AcpDialect {
  /** Subagent calls still open, with the description their child session is titled by. */
  const open: { call: string; description: string }[] = [];
  const bound = new Map<string, string>();
  const started = new Set<string>();
  const counts = new Map<string, number>();
  /** What each subagent has said so far: chunks arrive a few tokens at a time. */
  const said = new Map<string, string>();

  /** The call a child session works for; the session is told apart only by its title. */
  function parentOf(child: ChildSession) {
    const known = bound.get(child.id);
    if (known) return known;
    const taken = new Set(bound.values());
    const free = open.filter((item) => !taken.has(item.call));
    // Without a matching title only a lone candidate is certain enough to take.
    const match =
      free.find((item) => child.title !== undefined && item.description === child.title) ??
      (free.length === 1 ? free[0] : undefined);
    if (match) {
      bound.set(child.id, match.call);
      found.push({ id: match.call, session: child.id });
    }
    return match?.call;
  }

  /** Sessions found for tasks since the last patch; they travel with the next one. */
  const found: AcpTaskPatch[] = [];
  const flush = () => found.splice(0);

  const dialect: AcpDialect = extendPlainDialect({
    tool(update) {
      const child = childOf(update);
      const title = String(update.title || update.kind || "tool");
      // The calls of a child session are titled "<session title>: <tool>".
      const name =
        child?.title && title.startsWith(`${child.title}: `)
          ? title.slice(child.title.length + 2)
          : title;
      const parent = child && parentOf(child);
      return { name, ...(parent ? { parent } : {}) };
    },
    inner: (update) => childOf(update) !== undefined,
    chunk(update, text) {
      const child = childOf(update);
      if (!child) return undefined;
      const parent = parentOf(child);
      if (!parent) return [];
      const all = (said.get(parent) ?? "") + text;
      said.set(parent, all);
      return [...flush(), ...(all.trim() ? [{ id: parent, summary: shorten(all) }] : [])];
    },
    call(update, id) {
      const patches: AcpTaskPatch[] = [];
      const child = childOf(update);
      const parent = child && parentOf(child);
      patches.push(...flush());
      if (parent && update.sessionUpdate === "tool_call") {
        const count = (counts.get(parent) ?? 0) + 1;
        counts.set(parent, count);
        patches.push({ id: parent, tools: count, lastTool: dialect.tool(update).name });
      }
      const agent = subagentOf(update);
      if (agent && !started.has(id)) {
        started.add(id);
        open.push({ call: id, description: agent.description });
        patches.push({
          id,
          kind: "agent",
          title: agent.description,
          status: "running",
          background: false,
          subagent: agent.agent,
          ...(agent.prompt ? { prompt: agent.prompt } : {}),
          tool: id,
        });
      }
      const command = backgroundOf(update);
      if (command && !started.has(id)) {
        started.add(id);
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
    },
    end(update, id, output) {
      const index = open.findIndex((item) => item.call === id);
      if (index < 0) return [];
      // A subagent started in the background answers at once with its session and keeps working:
      // its call stays open so its later calls and messages still find the task.
      const session = /"sessionID"\s*:\s*"([^"]+)"/.exec(output)?.[1];
      if (session && /^\{[^]*"status"\s*:\s*"running"/.test(output.trimStart())) {
        bound.set(session, id);
        return [
          {
            id,
            status: "running",
            background: true,
            untracked: true,
            session,
          },
        ];
      }
      open.splice(index, 1);
      // Without a spoken answer the output is only metadata (a JSON object), not worth showing.
      const summary = shorten(
        unwrap(said.get(id) || (output.trimStart().startsWith("{") ? "" : output)),
      );
      return [
        {
          id,
          status: update.status === "failed" ? "error" : "done",
          ...(summary ? { summary } : {}),
          tools: counts.get(id) ?? 0,
        },
      ];
    },
  });
  return dialect;
}
