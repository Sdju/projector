import type { JudgeVerdict } from "@projector-ai/core/modules/agent-judge/index.ts";

/** An action Judge allowed without asking, kept in the answer's work block. */
export interface JudgeNote {
  tool: string;
  title?: string;
  verdict: JudgeVerdict;
  decision: "auto";
  at: number;
}
