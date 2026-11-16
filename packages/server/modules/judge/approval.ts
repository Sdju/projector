import {
  judgeAllows,
  type JudgeDecision,
  type JudgeSettings,
  type JudgeVerdict,
} from "@ai-projector/core/modules/agent-judge/index.ts";
import { judgeAction, type JudgeAction } from "./verdict.ts";

/** The part of an approval request the judge reads; the backend may add more. */
export interface JudgeApprovalRequest {
  tool: string;
  input: unknown;
  title?: string;
  detail?: string;
  persistent?: boolean;
  /** Added before the card is shown; the user sees it in the permission prompt. */
  judge?: JudgeVerdict;
}

export type JudgeAnswer = boolean | "always";

export interface JudgedApprovalOptions {
  approve: (request: JudgeApprovalRequest) => Promise<JudgeAnswer>;
  emit: (event: "judge", data: unknown) => void;
  settings: JudgeSettings;
  cwd?: string;
  backend?: string;
  signal?: AbortSignal;
  /** Tests replace the model call; the real path uses `judgeAction`. */
  judge?: (action: JudgeAction) => Promise<JudgeVerdict>;
}

/** The manual answer as it reads in the work block. */
function manualDecision(answer: JudgeAnswer): JudgeDecision {
  if (answer === false) return "denied";
  return answer === "always" ? "always" : "allowed";
}

/**
 * Wraps the user's approval: the judge explains the action in the card, or lets a low-risk action
 * run and leaves a visible note. A manual choice leaves the same note, so the work block keeps
 * both kinds of decisions. A failed judge never allows anything by itself.
 */
export function createJudgedApproval(options: JudgedApprovalOptions) {
  return async (request: JudgeApprovalRequest): Promise<JudgeAnswer> => {
    if (!options.settings.show && !options.settings.auto) return options.approve(request);
    const verdict = await (options.judge ?? judgeAction)({
      tool: request.tool,
      title: request.title,
      detail: request.detail,
      input: request.input,
      cwd: options.cwd,
      backend: options.backend,
      signal: options.signal,
    });
    const note = {
      tool: request.tool,
      title: request.title,
      verdict,
    };
    if (judgeAllows(options.settings, verdict)) {
      options.emit("judge", { ...note, decision: "auto", at: Date.now() });
      return true;
    }
    const answer = await options.approve({
      ...request,
      ...(options.settings.show ? { judge: verdict } : {}),
    });
    options.emit("judge", { ...note, decision: manualDecision(answer), at: Date.now() });
    return answer;
  };
}
