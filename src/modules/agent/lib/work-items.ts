import type { AgentToolView } from "../model/types.ts";

/** One step of a work group, in the order the answer happened: a thought or a run of calls. */
export type AgentWorkItem =
  | { key: string; type: "thought"; text: string }
  | { key: string; type: "tools"; tools: AgentToolView[] };
