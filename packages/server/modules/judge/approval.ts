import {
  judgeAllows,
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

/**
 * Wraps the user's approval: the judge explains the action in the card, or lets a low-risk action
 * run and leaves a visible note. A failed judge never allows anything by itself.
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
    if (judgeAllows(options.settings, verdict)) {
      options.emit("judge", {
        tool: request.tool,
        title: request.title,
        verdict,
        decision: "auto",
        at: Date.now(),
      });
      return true;
    }
    return options.approve({
      ...request,
      ...(options.settings.show ? { judge: verdict } : {}),
    });
  };
}
