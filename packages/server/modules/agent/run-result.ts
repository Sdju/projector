import { answerPreview } from "@ai-projector/core/modules/agent-answer/index.ts";
import {
  isAgentFailure,
  type AgentFailure,
} from "@ai-projector/core/modules/agent-failure/index.ts";
import type { AgentEmitter } from "./backend.ts";
import { failureFromError, makeFailure } from "./failure.ts";
import { hasAnswerForm, recordRecentRun, type RecentRun } from "./recent-runs.ts";

type ResultFields = "status" | "error" | "failure" | "resultPreview" | "awaitingReply" | "endedAt";

export function collectRunResult(onSession: (session: string) => void) {
  let collected = "";
  let finalText: string | undefined;
  let failure: AgentFailure | undefined;
  let session: string | undefined;

  function capture(publish: AgentEmitter): AgentEmitter {
    return (event, data) => {
      const body = (data ?? {}) as Record<string, unknown>;
      if (event === "error") {
        // The page and the saved turn get the same safe failure.
        failure = isAgentFailure(body.failure)
          ? body.failure
          : makeFailure({
              message: typeof body.error === "string" ? body.error : "Ошибка агента",
              status: typeof body.status === "number" ? body.status : null,
              code: typeof body.code === "string" ? body.code : null,
            });
        data = { error: failure.message, failure };
      } else if (event === "session" && typeof body.id === "string") {
        session = body.id;
        onSession(session);
      } else if (event === "text" && typeof body.text === "string") collected += body.text;
      else if (event === "done" && typeof body.text === "string" && body.text)
        finalText = body.text;
      publish(event, data);
    };
  }

  return {
    capture,
    get session() {
      return session;
    },
    fail(error: unknown) {
      failure ??= failureFromError(error);
    },
    async record(entry: Omit<RecentRun, ResultFields>, aborted: boolean) {
      const status = aborted ? "stopped" : failure ? "error" : "done";
      const answer = (finalText ?? collected).trim();
      const preview = answerPreview(answer, 300);
      await recordRecentRun({
        ...entry,
        status,
        ...(status === "error" && failure ? { error: failure.message, failure } : {}),
        ...(preview ? { resultPreview: preview } : {}),
        ...(status === "done" && hasAnswerForm(answer) ? { awaitingReply: true } : {}),
        endedAt: Date.now(),
      }).catch(() => {});
    },
  };
}
