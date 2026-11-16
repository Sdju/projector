import type { JudgeDecision, JudgeVerdict } from "@ai-projector/core/modules/agent-judge/index.ts";

/** A decision Judge made or the user made after its card, kept in the answer's work block. */
export interface JudgeNote {
  tool: string;
  title?: string;
  verdict: JudgeVerdict;
  decision: JudgeDecision;
  at: number;
}
