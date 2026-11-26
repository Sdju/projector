import { createApprovalBridge, createQuestionBridge } from "./command-bridge.ts";
import { createRun, readRun, removeRun, stopRun, trackRun } from "./agent-runs.ts";
import type { AgentRunRecord } from "./agent-runs.ts";
import { failureFromError } from "./failure.ts";
import type { AgentEventName } from "./backend.ts";
import type { AgentHistoryTurn } from "../providers/index.ts";
import { changedSince, snapshotGit } from "./jobs-files.ts";
import { resolveJudgeSettings } from "@ai-projector/core/modules/agent-judge/index.ts";
import { createJudgedApproval, readJudgeSettings } from "../judge/index.ts";
import { readChatJudge } from "./judge-store.ts";
import {
  RESULT_LIMIT,
  change,
  dropPending,
  flushJournal,
  live,
  onEvent,
  persist,
  record,
  wake,
  type Live,
} from "./jobs-live.ts";
import { type AgentJobStatus } from "./jobs-store.ts";
import { runAgent } from "./registry.ts";

/** A request nobody answered is refused after this long. */
const ANSWER_TIMEOUT_MS = 2 * 60 * 60 * 1000;

const clip = (text: string) => (text.length > RESULT_LIMIT ? text.slice(0, RESULT_LIMIT) : text);

async function finish(entry: Live): Promise<void> {
  const { job } = entry;
  const status: AgentJobStatus = entry.stopping ? "stopped" : entry.failure ? "error" : "done";
  job.result = clip((entry.final ?? entry.collected).trim());
  if (job.history?.at(-1)?.role === "user")
    job.history.push({ role: "assistant", content: job.result.slice(0, 20_000) });
  if (entry.failure && !entry.stopping) {
    job.error = entry.failure;
    if (entry.failureInfo) job.failure = entry.failureInfo;
  }
  job.pending = [];
  const changed = await changedSince(job.cwd, entry.snapshot);
  job.files = [...new Set([...job.files, ...changed, ...entry.touched])].sort().slice(0, 500);
  job.endedAt = Date.now();
  if (job.runId) await removeRun(job.runId).catch(() => {});
  change(entry, status);
  await persist(entry);
  await flushJournal(entry);
  live.delete(job.id);
  wake(entry);
}

export async function drive(
  entry: Live,
  attach: boolean,
  message = entry.job.task,
  history: AgentHistoryTurn[] = [],
): Promise<void> {
  const { job } = entry;
  let untrack: (() => void) | undefined;
  try {
    let run: AgentRunRecord | null;
    if (attach) {
      run = job.runId ? await readRun(job.runId) : null;
      if (!run) throw new Error("Ход задания потерян при перезапуске сервера");
    } else {
      run = {
        backend: job.backend,
        message,
        history,
        cwd: job.cwd,
        selection: job.selection,
        role: job.role,
        permissionMode: job.permissionMode,
        approvals: true,
        projectId: job.projectId,
        chat: `job:${job.id}`,
        messageId: job.messageId,
        ...(job.sessionId ? { sessionId: job.sessionId } : {}),
      };
      job.runId = await createRun(run);
      job.startedAt = Date.now();
      entry.snapshot = await snapshotGit(job.cwd);
      if (entry.snapshot) {
        if (entry.snapshot.head) job.base = entry.snapshot.head;
        job.dirty = [...entry.snapshot.dirty.keys()];
      }
      await persist(entry);
    }
    untrack = trackRun(job.runId!, () => entry.abort.abort());
    change(entry, "running");
    const emit = (event: AgentEventName, data: unknown) => onEvent(entry, event, data);
    await runAgent({
      ...run,
      backend: job.backend,
      run: { id: job.runId!, attach },
      approve: async (request) => {
        if (job.unattended) {
          record(entry, "answer", { auto: true, tool: request.tool, title: request.title });
          return true;
        }
        let id = "";
        const bridge = createApprovalBridge(
          (name, data) => {
            id = String((data as { id?: unknown }).id ?? "");
            emit(name, data);
          },
          entry.abort.signal,
          ANSWER_TIMEOUT_MS,
        );
        const approve = createJudgedApproval({
          approve: bridge,
          emit: (event, data) => emit(event, data),
          settings: resolveJudgeSettings(
            await readJudgeSettings(),
            job.origin ? readChatJudge(job.origin) : undefined,
          ),
          cwd: job.cwd,
          backend: job.backend,
          signal: entry.abort.signal,
        });
        try {
          return await approve(request);
        } catch {
          return false;
        } finally {
          if (id) dropPending(entry, id);
        }
      },
      ask: async (request) => {
        if (job.unattended) return null;
        let id = "";
        const bridge = createQuestionBridge(
          (name, data) => {
            id = String((data as { id?: unknown }).id ?? "");
            emit(name, data);
          },
          entry.abort.signal,
          ANSWER_TIMEOUT_MS,
        );
        try {
          return await bridge(request);
        } catch {
          return null;
        } finally {
          if (id) dropPending(entry, id);
        }
      },
      abort: entry.abort.signal,
      emit,
    });
  } catch (error) {
    if (!entry.stopping) {
      const failure = failureFromError(error);
      entry.failure = failure.message;
      entry.failureInfo = failure;
    }
  } finally {
    untrack?.();
  }
  if (entry.stopping && job.runId) await stopRun(job.runId).catch(() => {});
  // The final status becomes visible inside finish before its writes are done. Keep the promise
  // so a removal that sees that status can wait instead of racing the writes or the live entry.
  entry.finalizing = finish(entry);
  await entry.finalizing;
}
