import type { JudgeVerdict } from "@projector-ai/core/modules/agent-judge/index.ts";
import type { AgentToolView } from "../model/types.ts";

/** One step of a work group, in the order the answer happened: a thought, a judge note or calls. */
export type AgentWorkItem =
  | { key: string; type: "thought"; text: string }
  | {
      key: string;
      type: "judge";
      tool: string;
      title?: string;
      verdict: JudgeVerdict;
    }
  | { key: string; type: "tools"; tools: AgentToolView[] };
