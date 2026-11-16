import type { JudgeVerdict } from "@ai-projector/core/modules/agent-judge/index.ts";
import { deviceUrl } from "../../../common/utilities/device-url.ts";
import type { AgentBackendId, AgentQuestionRequest, AgentSecretRequest } from "../model/types.ts";

/** A pending user-facing request of a live run (permission with Judge, question, secret). */
export interface AgentRunPending {
  id: string;
  kind: "permission" | "question" | "secret";
  title: string;
  tool?: string;
  detail?: string;
  persistent?: boolean;
  judge?: JudgeVerdict;
  questions?: AgentQuestionRequest["questions"];
  custom?: boolean;
  reason?: string;
  destination?: AgentSecretRequest["destination"];
}

/** An agent process working right now, on any page. */
export interface LiveAgentRun {
  id: string;
  backend: AgentBackendId;
  projectId: string;
  chat: string;
  topic: string;
  status?: "running" | "needs-user";
  pending?: AgentRunPending[];
  session?: string;
  /** When the run started (ms since the epoch), for the elapsed time in the island. */
  startedAt?: number;
}

/** A finished chat run kept so notifications show completions and unanswered forms. */
export interface RecentAgentRun {
  id: string;
  backend: AgentBackendId;
  projectId: string;
  chat: string;
  topic: string;
  status: "done" | "error" | "stopped";
  error?: string;
  resultPreview?: string;
  awaitingReply?: boolean;
  session?: string;
  startedAt: number;
  endedAt: number;
}

export async function fetchRunsFeed(
  base?: string,
): Promise<{ runs: LiveAgentRun[]; recent: RecentAgentRun[] }> {
  const path = base ? `${base}/agent/runs` : deviceUrl("/api/agent/runs");
  const response = await fetch(path, { cache: "no-store" });
  if (!response.ok) throw new Error("Не удалось получить работающие процессы агентов");
  const data = (await response.json()) as { runs?: LiveAgentRun[]; recent?: RecentAgentRun[] };
  return { runs: data.runs ?? [], recent: data.recent ?? [] };
}

export async function fetchLiveRuns(base?: string): Promise<LiveAgentRun[]> {
  return (await fetchRunsFeed(base)).runs;
}

/** A run starts right after its message; the window keeps older turns of the same session out. */
const RUN_START_EARLY_MS = 2_000;
const RUN_START_LATE_MS = 60_000;

/**
 * The run to rejoin for a saved answer: a live one if the agent is still working, otherwise a
 * finished run that started for this very turn. A finished run replays its trace, which is how a
 * page that was reloaded mid-answer gets the text back even after the process is gone.
 */
export function pickRejoinRun(
  feed: { runs: LiveAgentRun[]; recent: RecentAgentRun[] },
  turn: {
    chat: string;
    backend: AgentBackendId;
    /** When the message was sent; absent in turns saved before it existed. */
    at?: number;
    /** The native session, to tell apart a later turn of the same chat. */
    session?: string;
  },
): string | undefined {
  const ownTurn = (startedAt: number | undefined) =>
    turn.at === undefined ||
    startedAt === undefined ||
    (startedAt >= turn.at - RUN_START_EARLY_MS && startedAt <= turn.at + RUN_START_LATE_MS);
  const [live] = feed.runs
    .filter(
      (run) =>
        run.chat === turn.chat &&
        run.backend === turn.backend &&
        ownTurn(run.startedAt) &&
        (!turn.session || !run.session || run.session === turn.session),
    )
    .sort((left, right) => (right.startedAt ?? 0) - (left.startedAt ?? 0));
  if (live) return live.id;
  if (turn.at === undefined) return undefined;
  const [finished] = feed.recent
    .filter(
      (run) =>
        run.chat === turn.chat &&
        run.backend === turn.backend &&
        run.status === "done" &&
        ownTurn(run.startedAt) &&
        (!turn.session || !run.session || run.session === turn.session),
    )
    .sort((left, right) => right.startedAt - left.startedAt);
  return finished?.id;
}

/** The run to rejoin for a saved answer, read from the server's live and recent runs. */
export async function findRejoinRun(
  chat: string,
  backend: AgentBackendId,
  at?: number,
  session?: string,
): Promise<string | undefined> {
  const feed = await fetchRunsFeed().catch(() => undefined);
  return feed ? pickRejoinRun(feed, { chat, backend, at, session }) : undefined;
}
