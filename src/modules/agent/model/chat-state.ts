import { reactive } from "vue";
import type {
  AgentCapabilities,
  AgentCommand,
  AgentControl,
  AgentHistoryTurn,
  AgentPermission,
  AgentPermissionMode,
  AgentQuestionRequest,
  AgentSecretRequest,
  AgentSelection,
  AgentSessionInfo,
  AgentTurn,
  MessagePart,
  QueuedMessage,
} from "./types.ts";

export const createState = () =>
  reactive({
    turns: [] as AgentTurn[],
    /** The saved conversation is being fetched: the turns are not the chat's yet. */
    loading: false,
    draft: "",
    draftParts: [] as MessagePart[],
    busy: false,
    error: "",
    phase: "",
    permissions: [] as AgentPermission[],
    questions: [] as AgentQuestionRequest[],
    secrets: [] as AgentSecretRequest[],
    permissionMode: "default" as AgentPermissionMode,
    controls: [] as AgentControl[],
    capabilities: {} as AgentCapabilities,
    commands: [] as AgentCommand[],
    selection: {} as AgentSelection,
    controlsError: "",
    sessions: [] as AgentSessionInfo[],
    sessionsLoading: false,
    sessionsError: "",
    abort: undefined as AbortController | undefined,
    /** The next message starts the chat in an isolated copy of the project. */
    isolate: false,
    /** The message that started the answer being written (what a live addition refers to). */
    activeMessage: "",
    /** Messages written while an answer was running; delivered at the next model boundary when supported. */
    queue: [] as QueuedMessage[],
    /** The queued message to send right after the answer is stopped. */
    interrupting: false,
    /** The user message being edited; sending the input replaces it and what follows. */
    editing: "",
    /** The turns cut off by an edit or rewind, waiting for the new message to become their sibling. */
    stash: undefined as { index: number; versions: AgentTurn[][] } | undefined,
  });

export type ChatState = ReturnType<typeof createState>;

export function summarize(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value.slice(0, 8000);
  try {
    return JSON.stringify(value, null, 2).slice(0, 8000);
  } catch {
    return "";
  }
}

/**
 * Closing a chat aborts its request, but a remount of the same chat (hot module replacement,
 * moving the tab) must not: the abort is delayed and cancelled when the chat comes back.
 */
export const RELEASE_DELAY_MS = 1500;

interface ChatRegistry {
  releases: Map<string, ReturnType<typeof setTimeout>>;
  /** Views currently showing each chat; a hot reload may mount the new one before unmounting the old. */
  viewers: Map<string, number>;
  sessions: Map<string, ChatState>;
  loads: Map<string, Promise<void>>;
  saves: Map<string, Promise<void>>;
  /** Chats with a save waiting behind the running one. */
  queued: Set<string>;
}

// Kept in `import.meta.hot.data`: editing this file re-evaluates it, and a running answer must
// keep its state, viewers and pending abort instead of being orphaned and then aborted.
const hot = (import.meta.hot?.data ?? {}) as { chats?: ChatRegistry };
const registry: ChatRegistry = (hot.chats ??= {
  releases: new Map(),
  viewers: new Map(),
  sessions: new Map(),
  loads: new Map(),
  saves: new Map(),
  queued: new Set(),
});
registry.queued ??= new Set();
// Sessions from before capabilities were introduced survive HMR with their live process intact.
for (const state of registry.sessions.values()) state.capabilities ??= {};
export const { releases, viewers, sessions, loads, saves, queued } = registry;

/** The conversation as turns, with what the answers' tool calls returned, for an agent without a session of its own. */
export function chatHistory(turns: AgentTurn[], withTools = false): AgentHistoryTurn[] {
  // Live additions are user messages in context, even though the UI nests them in the answer.
  const expanded = turns.flatMap((turn): AgentTurn[] => {
    if (turn.role !== "assistant" || !turn.parts?.some((part) => part.type === "note"))
      return [turn];
    const result: AgentTurn[] = [];
    let text = "";
    let tools: AgentTurn["tools"] = [];
    const flush = () => {
      if (text || tools.length) result.push({ ...turn, text, tools });
      text = "";
      tools = [];
    };
    for (const part of turn.parts) {
      if (part.type === "text") text += part.text;
      else if (part.type === "tool") {
        const tool = turn.tools.find((item) => item.id === part.id);
        if (tool) tools.push(tool);
      } else if (part.type === "note") {
        flush();
        result.push({ id: turn.id, role: "user", text: part.text, tools: [] });
      }
    }
    flush();
    return result;
  });
  return expanded.flatMap((item): AgentHistoryTurn[] => {
    const tools = (withTools ? item.tools : [])
      .filter((tool) => !tool.parent && tool.status !== "running")
      .map((tool) => ({
        id: tool.id,
        name: tool.name,
        ...(tool.input ? { input: tool.input } : {}),
        output: tool.detail,
        ...(tool.status === "error" ? { failed: true } : {}),
      }));
    if (!item.text.trim() && !tools.length) return [];
    return [{ role: item.role, content: item.text, ...(tools.length ? { tools } : {}) }];
  });
}
