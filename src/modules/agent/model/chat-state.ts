import { reactive } from "vue";
import type {
  AgentCommand,
  AgentControl,
  AgentPermission,
  AgentPermissionMode,
  AgentSelection,
  AgentSessionInfo,
  AgentTurn,
  MessagePart,
  QueuedMessage,
} from "./types.ts";

export const createState = () =>
  reactive({
    turns: [] as AgentTurn[],
    draft: "",
    draftParts: [] as MessagePart[],
    busy: false,
    error: "",
    phase: "",
    permissions: [] as AgentPermission[],
    permissionMode: "default" as AgentPermissionMode,
    controls: [] as AgentControl[],
    commands: [] as AgentCommand[],
    selection: {} as AgentSelection,
    controlsError: "",
    sessions: [] as AgentSessionInfo[],
    sessionsLoading: false,
    sessionsError: "",
    abort: undefined as AbortController | undefined,
    /** Messages written while an answer was running; each is sent when it ends. */
    queue: [] as QueuedMessage[],
    /** The queued message to send right after the answer is stopped. */
    interrupting: false,
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
});
export const { releases, viewers, sessions, loads, saves } = registry;
