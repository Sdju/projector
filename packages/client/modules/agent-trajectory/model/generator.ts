/**
 * Session → trajectory generator.
 *
 * An adapter turns one agent session into the panel's data. The generic adapter reads the turns
 * the chat already has; a backend adapter may read its own richer store (OpenCode keeps step
 * timings and usage in SQLite). A failing adapter falls back to the generic one unless disabled.
 */

import type { AgentTurn } from "../../agent-core/index.ts";
import { chatsOf, loadSessionTurns } from "../../agent-core/index.ts";
import { putTrajectoryDocument } from "./store.ts";
import { trajectoryFromTurns } from "./trajectory.ts";
import type { TrajectoryData, TrajectoryDocument } from "./types.ts";

/** What a generator needs to know about a session. */
export interface TrajectorySession {
  projectId: string;
  /** Agent backend: `projector`, `opencode`, `claude`, … */
  backend?: string;
  /** Key of an open chat; its turns are used without a backend read. */
  chat?: string;
  /** Native session id of a past conversation. */
  session?: string;
  title?: string;
  busy?: boolean;
  /** Turns already in hand, when the caller has them. */
  turns?: readonly AgentTurn[];
}

/** What an adapter may ask the host for. */
export interface TrajectoryAdapterContext {
  readonly session: TrajectorySession;
  /** Turns of the open chat, when the chat is open. */
  chatTurns(): readonly AgentTurn[] | undefined;
  /** Open-chat turns, supplied turns, or a read of the native session. */
  loadTurns(): Promise<readonly AgentTurn[]>;
  /** POST a JSON request to the Projector server; for backend-specific stores. */
  request<T>(path: string, body?: unknown): Promise<T>;
}

/** What an adapter returns before it becomes a stored document. */
export interface TrajectoryAdapterOutput {
  data: TrajectoryData;
  title?: string;
  subtitle?: string;
  source?: string;
}

/** One agent-specific conversion. Register it with `registerTrajectoryAdapter`. */
export interface TrajectoryAdapter {
  id: string;
  label: string;
  /** Backends it handles; absent means it is a generic fallback. */
  backends?: readonly string[];
  generate(
    session: TrajectorySession,
    context: TrajectoryAdapterContext,
  ): TrajectoryAdapterOutput | Promise<TrajectoryAdapterOutput>;
}

export interface TrajectoryGenerateOptions {
  /** Adapter id; absent resolves by backend, then the generic adapter. */
  adapter?: string;
  /** Document id and presentation overrides. */
  id?: string;
  title?: string;
  subtitle?: string;
  /** Use the generic adapter after a backend adapter fails. Defaults to true. */
  fallback?: boolean;
}

export interface TrajectoryGeneration {
  document: TrajectoryDocument;
  adapter: string;
  warning?: string;
}

const adapters = new Map<string, TrajectoryAdapter>();

/** Add or replace an adapter; returns a detaching function. */
export function registerTrajectoryAdapter(adapter: TrajectoryAdapter): () => void {
  adapters.set(adapter.id, adapter);
  return () => {
    if (adapters.get(adapter.id) === adapter) adapters.delete(adapter.id);
  };
}

export function trajectoryAdapters(): TrajectoryAdapter[] {
  return [...adapters.values()];
}

function adapterFor(session: TrajectorySession, requested?: string): TrajectoryAdapter {
  if (requested) {
    const exact = adapters.get(requested);
    if (!exact) throw new Error(`Неизвестный адаптер траектории: ${requested}`);
    if (exact === openCodeAdapter && session.backend !== "opencode")
      throw new Error("Адаптер opencode требует сессию OpenCode");
    if (exact === openCodeAdapter && (!session.session || session.chat)) return genericAdapter;
    return exact;
  }
  if (session.backend) {
    const backend = [...adapters.values()]
      .reverse()
      .find(
        (adapter) =>
          (adapter !== openCodeAdapter || (session.session && !session.chat)) &&
          adapter.backends?.includes(session.backend!),
      );
    if (backend) return backend;
  }
  const generic = adapters.get("turns");
  if (!generic) throw new Error("Адаптер истории чата не зарегистрирован");
  return generic;
}

function chatOf(session: TrajectorySession) {
  if (!session.chat) return undefined;
  return chatsOf(session.projectId).find((chat) => chat.key === session.chat);
}

class TrajectoryRequestError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new TrajectoryRequestError(
      response.status,
      typeof data?.error === "string" ? data.error : `HTTP ${response.status}: ${path}`,
    );
  return data as T;
}

function contextOf(session: TrajectorySession): TrajectoryAdapterContext {
  const chat = chatOf(session);
  const loadTurns = async (): Promise<readonly AgentTurn[]> => {
    if (session.turns) return session.turns;
    if (chat) return chat.turns();
    if (session.session && session.backend === "opencode") {
      const data = await postJson<{ turns: AgentTurn[] }>("/api/opencode/trajectory", {
        projectId: session.projectId,
        sessionId: session.session,
        format: "turns",
      });
      return data.turns;
    }
    if (session.session && session.backend)
      return loadSessionTurns(session.backend, session.projectId, session.session);
    throw new Error("Укажите открытый чат или session вместе с backend");
  };
  return {
    session,
    chatTurns: () => (session.turns ? session.turns : chat?.turns()),
    loadTurns,
    request: (path, body = {}) => postJson(path, body),
  };
}

function turnAdapter(id: string, label: string, backends?: readonly string[]): TrajectoryAdapter {
  return {
    id,
    label,
    ...(backends ? { backends } : {}),
    async generate(session, context) {
      const turns = await context.loadTurns();
      return {
        data: trajectoryFromTurns(turns, { busy: session.busy === true }),
        ...(session.title ? { title: session.title } : {}),
        source: id,
      };
    },
  };
}

const genericAdapter = turnAdapter("turns", "История чата");

const projectorAdapter = turnAdapter("projector", "Projector", ["projector"]);

const openCodeAdapter: TrajectoryAdapter = {
  id: "opencode",
  label: "OpenCode · шаги и usage",
  backends: ["opencode"],
  async generate(session, context) {
    const payload = await context.request<{
      title?: string;
      subtitle?: string;
      data: TrajectoryData;
      source?: string;
    }>("/api/opencode/trajectory", {
      projectId: session.projectId,
      sessionId: session.session,
    });
    return {
      data: payload.data,
      ...(payload.title ? { title: payload.title } : {}),
      ...(payload.subtitle ? { subtitle: payload.subtitle } : {}),
      source: "opencode",
    };
  },
};

registerTrajectoryAdapter(genericAdapter);
registerTrajectoryAdapter(projectorAdapter);
registerTrajectoryAdapter(openCodeAdapter);

/**
 * Generate and store a document for one session.
 *
 * A backend adapter that throws (no database, a broken request) falls back to the generic turn
 * adapter, and the result names that warning instead of failing the whole command.
 */
export async function generateTrajectoryDocument(
  session: TrajectorySession,
  options: TrajectoryGenerateOptions = {},
): Promise<TrajectoryGeneration> {
  const wanted = adapterFor(session, options.adapter);
  const context = contextOf(session);
  let adapter = wanted;
  let output: TrajectoryAdapterOutput;
  let warning: string | undefined;
  try {
    output = await wanted.generate(session, context);
  } catch (error) {
    if (wanted.id === "turns" || options.fallback === false) throw error;
    if (
      wanted === openCodeAdapter &&
      error instanceof TrajectoryRequestError &&
      (error.status === 403 || error.status === 404)
    )
      throw error;
    warning = error instanceof Error ? error.message : "Адаптер не смог прочитать сессию";
    adapter = adapterFor(session, "turns");
    output = await adapter.generate(session, context);
  }

  const document = putTrajectoryDocument(
    {
      data: output.data,
      ...(output.title ? { title: output.title } : {}),
      ...(output.subtitle ? { subtitle: output.subtitle } : {}),
      ...(output.source ? { source: output.source } : {}),
    },
    {
      ...(options.id ? { id: options.id } : {}),
      ...(options.title ? { title: options.title } : {}),
      ...(options.subtitle ? { subtitle: options.subtitle } : {}),
      source: adapter.id,
    },
  );
  return {
    document,
    adapter: adapter.id,
    ...(warning ? { warning } : {}),
  };
}
