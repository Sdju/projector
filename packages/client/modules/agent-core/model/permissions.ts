import type { JudgeVerdict } from "@projector/core/modules/agent-judge/index.ts";

/** A sensitive tool call waiting for the user's decision. */
export interface AgentPermission {
  id: string;
  tool: string;
  title: string;
  detail: string;
  /** The backend offers a durable "always" choice for this tool. */
  persistent: boolean;
  /** What the judge thinks of the action; absent when the judge is off or unavailable. */
  judge?: JudgeVerdict;
}
