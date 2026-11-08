import { reactive } from "vue";
import type { JudgeOverride } from "@projector/core/modules/agent-judge/index.ts";
import type { AgentRoleSnapshot } from "@projector/core/modules/agent-role/index.ts";
import type {
  AgentCapabilities,
  AgentCommand,
  AgentControl,
  AgentHistoryTurn,
  AgentPermission,
  AgentPermissionMode,
  AgentQuestionRequest,
  AgentRecentChat,
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
    /** When the last event of the answer arrived (ms since the epoch), for stall diagnosis. */
    lastEventAt: 0,
    permissions: [] as AgentPermission[],
    questions: [] as AgentQuestionRequest[],
    secrets: [] as AgentSecretRequest[],
    permissionMode: "default" as AgentPermissionMode,
    controls: [] as AgentControl[],
    capabilities: {} as AgentCapabilities,
    commands: [] as AgentCommand[],
    selection: {} as AgentSelection,
    /** The role the chat started with; absent for an ordinary chat. */
    roleSnapshot: undefined as AgentRoleSnapshot | undefined,
    controlsError: "",
    sessions: [] as AgentSessionInfo[],
    sessionsLoading: false,
    sessionsError: "",
    /** Chats of the project kept on disk, newest first: a closed tab can be opened again. */
    recent: [] as AgentRecentChat[],
    recentLoading: false,
    recentError: "",
    abort: undefined as AbortController | undefined,
    /** The next message starts the chat in an isolated copy of the project. */
    isolate: false,
    /** Feature ids enabled for this chat only; undefined means the user's defaults. */
    featureOverrides: undefined as string[] | undefined,
    /** Judge settings for this chat only; undefined means the global ones. */
    judgeOverride: undefined as JudgeOverride | undefined,
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
    const json = JSON.stringify(value, null, 2);
    if (json.length <= 8000) return json;
    if (typeof value === "object" && !Array.isArray(value)) {
      const trimmed = Object.fromEntries(
        Object.entries(value).map(([key, item]) => [
          key,
          typeof item === "string" && item.length > 3500 ? `${item.slice(0, 3500)}…` : item,
        ]),
      );
      const compact = JSON.stringify(trimmed, null, 2);
      if (compact.length <= 8000) return compact;
    }
    return json.slice(0, 8000);
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

/** A chat view starts showing this chat, and stops when it goes away (see `RELEASE_DELAY_MS`). */
export function chatPresence(key: string, abort: () => void) {
  return {
    attach() {
      viewers.set(key, (viewers.get(key) ?? 0) + 1);
    },
    release() {
      viewers.set(key, Math.max(0, (viewers.get(key) ?? 1) - 1));
      if (viewers.get(key)) return;
      clearTimeout(releases.get(key));
      releases.set(
        key,
        setTimeout(() => {
          releases.delete(key);
          if (!viewers.get(key)) abort();
        }, RELEASE_DELAY_MS),
      );
    },
  };
}

/** The reasoning of an answer, in the order it was shown. */
function thoughtsOf(turn: AgentTurn): string {
  if (turn.role !== "assistant") return "";
  return (turn.parts ?? [])
    .filter((part) => part.type === "thought")
    .map((part) => part.text.trim())
    .filter(Boolean)
    .join("\n\n");
}

/**
 * The conversation as turns, with what the answers' tool calls returned, for an agent without a
 * session of its own. `withThoughts` is for Lens: it names the intent behind the calls.
 */
export function chatHistory(
  turns: AgentTurn[],
  withTools = false,
  withThoughts = false,
): AgentHistoryTurn[] {
  type Expanded = {
    role: "user" | "assistant";
    text: string;
    thoughts: string;
    tools: AgentTurn["tools"];
  };
  // Live additions are user messages in context, even though the UI nests them in the answer.
  const expanded = turns.flatMap((turn): Expanded[] => {
    const plain = (): Expanded => ({
      role: turn.role,
      text: turn.text,
      thoughts: withThoughts ? thoughtsOf(turn) : "",
      tools: turn.tools,
    });
    if (turn.role !== "assistant" || !turn.parts?.some((part) => part.type === "note"))
      return [plain()];
    const result: Expanded[] = [];
    let text = "";
    let thoughts = "";
    let tools: AgentTurn["tools"] = [];
    const flush = () => {
      if (text || thoughts || tools.length)
        result.push({ role: "assistant", text, thoughts, tools });
      text = "";
      thoughts = "";
      tools = [];
    };
    for (const part of turn.parts) {
      if (part.type === "text") text += part.text;
      else if (part.type === "thought" && withThoughts)
        thoughts += `${thoughts ? "\n\n" : ""}${part.text}`;
      else if (part.type === "tool") {
        const tool = turn.tools.find((item) => item.id === part.id);
        if (tool) tools.push(tool);
      } else if (part.type === "note") {
        flush();
        result.push({ role: "user", text: part.text, thoughts: "", tools: [] });
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
    const thoughts = item.thoughts.trim();
    if (!item.text.trim() && !thoughts && !tools.length) return [];
    return [
      {
        role: item.role,
        content: item.text,
        ...(thoughts ? { thoughts } : {}),
        ...(tools.length ? { tools } : {}),
      },
    ];
  });
}
