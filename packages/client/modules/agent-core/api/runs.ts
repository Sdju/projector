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
