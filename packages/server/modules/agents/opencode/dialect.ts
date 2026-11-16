import {
  extendPlainDialect,
  inputOf,
  readCompaction,
  shorten,
  type AcpCompaction,
  type AcpDialect,
  type AcpTaskPatch,
  type AcpUpdate,
} from "../acp/index.ts";
import { cleanReadOutput } from "./read.ts";
import { openCodeIdleOutcomes } from "./sessions.ts";

/**
 * OpenCode runs a subagent as a `subagent` tool call and marks everything the subagent does
 * (calls and messages) with the id and title of its child session in `_meta`. A background
 * subagent answers at once with a session id (JSON or prose) and keeps working after `end_turn`
 * on the same ACP connection (permissions) — hard hold. Completion notify is often only for the
 * next model turn, so `poll` also clears holds from OpenCode `idle_outcome`. A shell moved to the
 * background (`rawInput.background` + command) never reports its end.
 */
interface ChildSession {
  id: string;
  title?: string;
}

/**
 * OpenCode ids hold `ms * 4096 + counter` cut to 48 bits, so only the low 36 bits of the time
 * survive (about 2.2 years): the full time is the one closest to `now`.
 */
export function opencodeIdTime(id: unknown, now = Date.now()): number | undefined {
  const hex = typeof id === "string" ? /^msg_([0-9a-f]{12})/.exec(id)?.[1] : undefined;
  if (!hex) return undefined;
  const period = 2 ** 36;
  const low = Math.floor(parseInt(hex, 16) / 4096);
  return low + Math.round((now - low) / period) * period;
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

/** The provider retry OpenCode reports while it waits: `null` means the wait is over. */
function retryOf(update: AcpUpdate) {
  const meta = update._meta as Record<string, unknown> | undefined;
  if (!meta || !("opencode/retry" in meta)) return undefined;
  const raw = meta["opencode/retry"];
  if (raw === null) return null;
  if (!raw || typeof raw !== "object") return undefined;
  const { attempt, nextRetryAt, error } = raw as {
    attempt?: unknown;
    nextRetryAt?: unknown;
    error?: { message?: unknown };
  };
  if (typeof attempt !== "number" || !Number.isFinite(attempt)) return undefined;
  const at = typeof nextRetryAt === "string" ? Date.parse(nextRetryAt) : NaN;
  const delay = Number.isFinite(at) ? Math.max(0, at - Date.now()) : undefined;
  const message = typeof error?.message === "string" ? error.message : undefined;
  return {
    // OpenCode counts the attempt it is about to make; the chat names the repeat.
    attempt: Math.max(1, Math.trunc(attempt) - 1),
    ...(delay !== undefined ? { delay } : {}),
    ...(message ? { message } : {}),
  };
}

/**
 * Older OpenCode builds report compaction in `session_info_update._meta`; newer ones (with the
 * client's `session.compaction` capability) use the standard `compaction_update` instead.
 */
function compactionOf(update: AcpUpdate): AcpCompaction | undefined {
  if (update.sessionUpdate !== "session_info_update") return readCompaction(update);
  const meta = update._meta as Record<string, unknown> | undefined;
  const raw = meta?.["opencode/compaction"];
  if (!raw || typeof raw !== "object") return undefined;
  const { status, messageId, summary, error } = raw as {
    status?: unknown;
    messageId?: unknown;
    summary?: unknown;
    error?: unknown;
  };
  const id = typeof messageId === "string" ? messageId : undefined;
  const withId = id ? { id } : {};
  if (status === "started") return { ...withId, status: "started" };
  if (status === "completed")
    return {
      ...withId,
      status: "completed",
      ...(typeof summary === "string" && summary.trim() ? { summary: summary.trim() } : {}),
    };
  if (status === "failed") {
    const text =
      typeof error === "string"
        ? error
        : typeof (error as { message?: unknown } | null)?.message === "string"
          ? (error as { message: string }).message
          : "";
    return { ...withId, status: "failed", ...(text ? { error: text } : {}) };
  }
  return undefined;
}

/** The input of the call that starts a subagent; it arrives with a later update, not the first. */
function subagentOf(update: AcpUpdate) {
  const { agent, description, prompt, background } = inputOf(update);
  if (typeof agent !== "string") return undefined;
  return {
    agent,
    description: typeof description === "string" ? description : agent,
    background: background === true,
    ...(typeof prompt === "string" && prompt ? { prompt } : {}),
  };
}

/** The result of a subagent call wraps the subagent's answer in `<subagent ...>` tags. */
const unwrap = (text: string) => text.replace(/<\/?subagent[^>]*>/g, "");

function backgroundOf(update: AcpUpdate) {
  const { background, command } = inputOf(update);
  return background === true && typeof command === "string" ? command : undefined;
}

/**
 * Background `subagent` receipt: JSON `{"sessionID","status":"running"}` or the prose
 * `working in the background (sessionID: ses_…)`.
 */
function backgroundSession(output: string): string | undefined {
  const trimmed = output.trimStart();
  const json = /"sessionID"\s*:\s*"([^"]+)"/.exec(trimmed)?.[1];
  if (json && /^\{[^]*"status"\s*:\s*"running"/.test(trimmed)) return json;
  return (
    /working in the background\s*\(\s*sessionID:\s*(ses_[^\s)]+)/i.exec(output)?.[1] ??
    /(?:^|\n)\s*sessionID:\s*(ses_\S+)/i.exec(output)?.[1]
  );
}

/** Later notify / wrap when a background child finished (same ACP connection, after `end_turn`). */
function backgroundEnded(
  text: string,
): { session: string; status: "done" | "error" | "stopped" }[] {
  const out: { session: string; status: "done" | "error" | "stopped" }[] = [];
  const seen = new Set<string>();
  const push = (session: string, status: "done" | "error" | "stopped") => {
    if (seen.has(session)) return;
    seen.add(session);
    out.push({ session, status });
  };
  for (const match of text.matchAll(
    /<subagent\b[^>]*\bsessionID="(ses_[^"]+)"[^>]*\bstate="(completed|failed|error|cancelled)"[^>]*>/gi,
  )) {
    const state = match[2]!.toLowerCase();
    push(match[1]!, state === "completed" ? "done" : state === "cancelled" ? "stopped" : "error");
  }
  for (const match of text.matchAll(/Subagent failed \(sessionID:\s*(ses_[^)]+)\)/gi)) {
    push(match[1]!, "error");
  }
  for (const match of text.matchAll(/Subagent cancelled \(sessionID:\s*(ses_[^)]+)\)/gi)) {
    push(match[1]!, "stopped");
  }
  return out;
}

/** A call that reads a file: its result is a framed file body, not raw tool text. */
const readsFile = (update: AcpUpdate) =>
  update.kind === "read" || String(update.title ?? "").toLowerCase() === "read";

export function createOpencodeDialect(
  options: { idleOutcomes?: typeof openCodeIdleOutcomes } = {},
): AcpDialect {
  const idleOutcomes = options.idleOutcomes ?? openCodeIdleOutcomes;
  /** Subagent calls still open, with the description their child session is titled by. */
  const open: { call: string; description: string }[] = [];
  const bound = new Map<string, string>();
  const started = new Set<string>();
  const counts = new Map<string, number>();
  /** What each subagent has said so far: chunks arrive a few tokens at a time. */
  const said = new Map<string, string>();
  /** File reads whose result is a framed body: only those get the frame removed. */
  const reads = new Set<string>();

  function endBackground(
    session: string,
    status: "done" | "error" | "stopped",
  ): AcpTaskPatch | undefined {
    const id = bound.get(session);
    if (!id) return undefined;
    const index = open.findIndex((entry) => entry.call === id);
    if (index < 0) return undefined;
    open.splice(index, 1);
    return {
      id,
      status,
      background: true,
      session,
      tools: counts.get(id) ?? 0,
      ...(said.get(id)?.trim() ? { summary: shorten(said.get(id)!) } : {}),
    };
  }

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
    time: (update) => opencodeIdTime(update.messageId),
    retry: retryOf,
    compaction: compactionOf,
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
      if (!child) {
        // Parent-level notify after `end_turn`: clear hard-held background tasks.
        const ended = backgroundEnded(text);
        if (!ended.length) return undefined;
        const patches: AcpTaskPatch[] = [...flush()];
        for (const item of ended) {
          const patch = endBackground(item.session, item.status);
          if (patch) patches.push(patch);
        }
        return patches;
      }
      const parent = parentOf(child);
      if (!parent) return [];
      const all = (said.get(parent) ?? "") + text;
      said.set(parent, all);
      return [...flush(), ...(all.trim() ? [{ id: parent, summary: shorten(all) }] : [])];
    },
    call(update, id) {
      const patches: AcpTaskPatch[] = [];
      if (readsFile(update)) reads.add(id);
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
          // Hard hold: children still need this connection for permissions and completion notify.
          background: agent.background,
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
    result(_update, id, output) {
      return reads.has(id) ? cleanReadOutput(output) : output;
    },
    end(update, id, output) {
      const index = open.findIndex((item) => item.call === id);
      if (index < 0) return [];
      // Background subagent: immediate receipt with session; child keeps working on this connection.
      const session = backgroundSession(output);
      if (session) {
        bound.set(session, id);
        return [
          {
            id,
            status: "running",
            background: true,
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
    poll() {
      const sessions = [...bound.keys()].filter((session) => {
        const id = bound.get(session);
        return id !== undefined && open.some((entry) => entry.call === id);
      });
      if (!sessions.length) return [];
      const patches: AcpTaskPatch[] = [];
      for (const [session, status] of idleOutcomes(sessions)) {
        const patch = endBackground(session, status);
        if (patch) patches.push(patch);
      }
      return patches;
    },
  });
  return dialect;
}
