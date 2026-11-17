import { randomUUID } from "node:crypto";
import { stat } from "node:fs/promises";
import { answerPreview } from "@ai-projector/core/modules/agent-answer/index.ts";
import {
  isAgentFailure,
  type AgentFailure,
} from "@ai-projector/core/modules/agent-failure/index.ts";
import { resolveJudgeSettings } from "@ai-projector/core/modules/agent-judge/index.ts";
import {
  createRun,
  listLiveRuns,
  readRun,
  rememberSession,
  schedulePrune,
  trackRun,
} from "./agent-runs.ts";
import type { AgentRunRecord } from "./agent-runs.ts";
import type { AgentEventName } from "./backend.ts";
import {
  createApprovalBridge,
  createQuestionBridge,
  createSecretBridge,
} from "./command-bridge.ts";
import { failureFromError, makeFailure } from "./failure.ts";
import { chatMetaOf, readChatFeatures } from "./history-store.ts";
import { readAgentHistory } from "./history.ts";
import { readChatJudge } from "./judge-store.ts";
import { readChatRole } from "./role-store.ts";
import { isAgentAvailable, runAgent } from "./registry.ts";
import type { AgentHistoryTurn } from "../providers/index.ts";
import type { RunDriver } from "./run-hub.ts";
import { driveRun } from "./run-hub.ts";
import {
  hasAnswerForm,
  listRecentRuns,
  recordRecentRun,
  setRecentRunResume,
} from "./recent-runs.ts";
import type { RecentRun } from "./recent-runs.ts";
import { preferences } from "../preferences/index.ts";
import { createJudgedApproval, readJudgeSettings } from "../judge/index.ts";

/** The built-in agent replays the saved chat; external agents continue their own native session. */
const PROJECTOR_BACKEND = "projector";
/** What the user would have typed to let a stopped answer go on. */
const CONTINUE_MESSAGE = "продолжай";
/** A waiting page sends first: the sweep only takes a plan this old so the two never race. */
const RESUME_GRACE_MS = 30_000;
/** A plan older than this is stale: the chat is better continued by hand. */
const RESUME_OVERDUE_MS = 24 * 60 * 60 * 1000;
const SWEEP_INTERVAL_MS = 30_000;
/** The replayed conversation is bounded; a native session carries its own history. */
const HISTORY_TURNS = 30;
const HISTORY_TEXT_LIMIT = 20_000;
/** A request nobody answers is refused after this long, as in a background job. */
const ANSWER_TIMEOUT_MS = 2 * 60 * 60 * 1000;

/** The fields of a finished run a planned continuation depends on. */
type ResumeCandidate = Pick<RecentRun, "chat" | "projectId" | "status" | "failure" | "resume">;

/**
 * Whether a finished run is due to be continued without a page: the user planned it, the grace
 * period for an open page has passed, the answer stopped on a usage limit and the reset is recent.
 */
export function dueResume(entry: ResumeCandidate, now: number): boolean {
  const plan = entry.resume;
  if (plan?.auto !== true) return false;
  if (plan.at + RESUME_GRACE_MS > now) return false;
  if (entry.status !== "error") return false;
  if (entry.failure?.class !== "usage_limit") return false;
  // A plan missed for a day is stale: sending "continue" long after the reset may be wrong.
  if (now - plan.at >= RESUME_OVERDUE_MS) return false;
  return !!entry.chat && !!entry.projectId;
}

const clip = (text: string) =>
  text.length > HISTORY_TEXT_LIMIT ? text.slice(0, HISTORY_TEXT_LIMIT) : text;

/** A saved turn as the validator of `history.ts` guarantees it; its declared type keeps forks only. */
interface SavedTurn {
  role: "user" | "assistant";
  text: string;
  tools: {
    id: string;
    name: string;
    status: "running" | "done" | "error";
    input?: string;
    detail: string;
  }[];
}

/** The saved chat as the model needs it: the last turns with their tool calls, bounded. */
function historyFrom(turns: Awaited<ReturnType<typeof readAgentHistory>>): AgentHistoryTurn[] {
  const saved = turns as unknown as SavedTurn[];
  return saved.slice(-HISTORY_TURNS).map((turn) => ({
    role: turn.role,
    content: clip(turn.text),
    tools: turn.tools.map((tool) => ({
      id: tool.id,
      name: tool.name,
      output: clip(tool.detail),
      ...(tool.input ? { input: clip(tool.input) } : {}),
      failed: tool.status === "error",
    })),
  }));
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

/** Whether every prerequisite of this continuation still holds; a changed answer is not repeated. */
async function ready(entry: RecentRun): Promise<boolean> {
  if (!chatMetaOf(entry.chat)) return false;
  if (!entry.cwd || !(await isDirectory(entry.cwd))) return false;
  if (!isAgentAvailable(entry.backend)) return false;
  if ((await preferences()).disabledAgents.includes(entry.backend)) return false;
  // An external agent has no saved transcript here: without its session there is nothing to continue.
  if (entry.backend !== PROJECTOR_BACKEND && !entry.session) return false;
  return true;
}

/**
 * Continues one chat in the background: a stored run, a silent viewer and the same approval,
 * question and secret bridges a background job uses. The result replaces the failed entry, so the
 * panel shows the continuation instead of the old quota error.
 */
async function startResume(entry: RecentRun): Promise<void> {
  const { chat, backend } = entry;
  const cwd = entry.cwd;
  if (!chat || !cwd) return;
  const startedAt = Date.now();
  const abort = new AbortController();
  let runId: string | undefined;
  let driver: RunDriver | undefined;
  let untrack: (() => void) | undefined;
  let failure: AgentFailure | undefined;
  let collected = "";
  let finalText: string | undefined;
  let lastSession: string | undefined;
  try {
    // The plan is claimed before anything else: a page that wakes up now must not send too.
    if (!(await setRecentRunResume(chat, null))) return;
    activeResumes.set(chat, abort);
    // The built-in agent starts from the saved chat; an external one continues its native session.
    const history = backend === PROJECTOR_BACKEND ? historyFrom(await readAgentHistory(chat)) : [];
    const record: AgentRunRecord = {
      backend,
      message: CONTINUE_MESSAGE,
      history,
      projectId: entry.projectId,
      chat,
      cwd,
      approvals: true,
      role: readChatRole(chat),
      features: readChatFeatures(chat),
      judge: readChatJudge(chat),
      messageId: randomUUID(),
      ...(entry.selection ? { selection: entry.selection } : {}),
      ...(entry.permissionMode ? { permissionMode: entry.permissionMode } : {}),
      ...(entry.session ? { sessionId: entry.session } : {}),
    };
    const id = await createRun(record);
    runId = id;
    driver = driveRun(id, { emit() {}, close() {} });
    untrack = trackRun(id, () => abort.abort());
    const emit = (event: AgentEventName, data: unknown) => {
      let payload = data;
      // The page and the saved turn get the same safe failure, never a raw provider error.
      if (event === "error") {
        const body = (data ?? {}) as {
          error?: unknown;
          failure?: unknown;
          status?: unknown;
          code?: unknown;
        };
        const text = typeof body.error === "string" ? body.error : "Ошибка агента";
        const info: AgentFailure = isAgentFailure(body.failure)
          ? body.failure
          : makeFailure({
              message: text,
              status: typeof body.status === "number" ? body.status : null,
              code: typeof body.code === "string" ? body.code : null,
            });
        failure = info;
        payload = { error: info.message, failure: info };
      }
      const body = (payload ?? {}) as Record<string, unknown>;
      if (event === "session" && typeof body.id === "string") {
        lastSession = body.id;
        void rememberSession(id, body.id).catch(() => {});
      } else if (event === "text" && typeof body.text === "string") collected += body.text;
      else if (event === "done" && typeof body.text === "string" && body.text)
        finalText = body.text;
      driver?.publish(event, payload);
    };
    await runAgent({
      ...record,
      backend,
      run: { id, attach: false },
      approve: async (request) => {
        const bridge = createApprovalBridge(
          (name, data) => emit(name, data),
          abort.signal,
          ANSWER_TIMEOUT_MS,
        );
        const approve = createJudgedApproval({
          approve: bridge,
          emit: (event, data) => emit(event, data),
          settings: resolveJudgeSettings(await readJudgeSettings(), readChatJudge(chat)),
          cwd,
          backend,
          signal: abort.signal,
        });
        try {
          return await approve(request);
        } catch {
          return false;
        }
      },
      ask: async (request) => {
        const bridge = createQuestionBridge(
          (name, data) => emit(name, data),
          abort.signal,
          ANSWER_TIMEOUT_MS,
        );
        try {
          return await bridge(request);
        } catch {
          return null;
        }
      },
      secret: async (request) => {
        const bridge = createSecretBridge(
          (name, data) => emit(name, data),
          abort.signal,
          ANSWER_TIMEOUT_MS,
        );
        try {
          return await bridge(request);
        } catch {
          return null;
        }
      },
      abort: abort.signal,
      emit,
    });
  } catch (error) {
    // An emitted failure is the agent's own verdict; a thrown one is classified here.
    failure ??= failureFromError(error);
  } finally {
    driver?.finish();
    untrack?.();
    if (activeResumes.get(chat) === abort) activeResumes.delete(chat);
    schedulePrune();
  }

  const status = abort.signal.aborted ? "stopped" : failure ? "error" : "done";
  const answer = (finalText ?? collected).trim();
  const preview = answerPreview(answer, 300);
  const stored = runId ? await readRun(runId).catch(() => null) : null;
  const session = stored?.session ?? lastSession ?? entry.session;
  // A person may have started a newer run while this one was finishing: its record must win.
  const live = await listLiveRuns().catch(() => []);
  if (live.some((item) => item.chat === chat && item.id !== runId)) return;
  try {
    await recordRecentRun({
      id: runId ?? randomUUID(),
      backend,
      projectId: entry.projectId,
      chat,
      topic: entry.topic || CONTINUE_MESSAGE,
      status,
      // A failed continuation keeps its class and reset time, so the user can plan another one.
      ...(status === "error" && failure ? { error: failure.message, failure } : {}),
      ...(preview ? { resultPreview: preview } : {}),
      ...(status === "done" && answer && hasAnswerForm(answer) ? { awaitingReply: true } : {}),
      ...(session ? { session } : {}),
      ...(cwd ? { cwd } : {}),
      ...(entry.selection ? { selection: entry.selection } : {}),
      ...(entry.permissionMode ? { permissionMode: entry.permissionMode } : {}),
      startedAt,
      endedAt: Date.now(),
    });
  } catch {
    // The continuation itself is over; a write failure must not take the server down.
  }
}

const host = globalThis as typeof globalThis & {
  projectorChatResumeTimer?: ReturnType<typeof setInterval>;
  // Vite reloads this module without stopping its starts: the guard lives across reloads.
  projectorChatResumesStarting?: Set<string>;
  /** Live continuations by chat, so a new message can stop one before it and the user race. */
  projectorChatResumeRuns?: Map<string, AbortController>;
};
const starting = (host.projectorChatResumesStarting ??= new Set<string>());
const activeResumes = (host.projectorChatResumeRuns ??= new Map<string, AbortController>());

/** A person wrote in the chat: the headless continuation must not keep writing in the same folder. */
export function abortChatResume(chat: string): void {
  activeResumes.get(chat)?.abort();
  activeResumes.delete(chat);
}

/**
 * Starts every continuation that has come due. Runs begin in the background: the sweep must stay
 * short, and the next one will find each chat claimed or already finished.
 */
export async function sweepChatResumes(now = Date.now()): Promise<void> {
  let entries: RecentRun[];
  let live: Awaited<ReturnType<typeof listLiveRuns>>;
  try {
    // The list is read as of the start of the overdue window: `recent-runs` keeps a plan only while
    // it is ahead of the read time, and reading at `now` would drop every plan exactly when it is
    // due. The real `now` below still decides what may actually start.
    [entries, live] = await Promise.all([listRecentRuns(now - RESUME_OVERDUE_MS), listLiveRuns()]);
  } catch {
    return;
  }
  const busy = new Set(live.map((run) => run.chat));
  for (const entry of entries) {
    if (!dueResume(entry, now)) continue;
    if (!entry.chat || busy.has(entry.chat) || starting.has(entry.chat)) continue;
    try {
      if (!(await ready(entry))) continue;
    } catch {
      continue;
    }
    starting.add(entry.chat);
    void startResume(entry)
      .catch(() => {})
      .finally(() => starting.delete(entry.chat));
  }
}

/**
 * Begins the background sweep: once now and then every 30 seconds. A second call (a hot reload)
 * keeps the timer already running, so a chat is never continued twice.
 */
export function startChatResume(): void {
  if (host.projectorChatResumeTimer !== undefined) return;
  const timer = setInterval(() => void sweepChatResumes().catch(() => {}), SWEEP_INTERVAL_MS);
  timer.unref();
  host.projectorChatResumeTimer = timer;
  void sweepChatResumes().catch(() => {});
}
