import type { AgentTaskPatch } from "@ai-projector/core/modules/agent-task/index.ts";
import type { JudgeVerdict } from "@ai-projector/core/modules/agent-judge/index.ts";
import type { Project } from "../../project/index.ts";
import type { JudgeNote } from "./judge-note.ts";
import type {
  AgentCommand,
  AgentCommandRequest,
  AgentContext,
  AgentControl,
  AgentQuestionRequest,
  AgentSecretRequest,
  AgentSessionRef,
  AgentUsage,
} from "./types.ts";

export type AgentEvent =
  | { event: "command-request"; data: AgentCommandRequest }
  | {
      event: "permission-request";
      data: {
        id: string;
        tool: string;
        input: unknown;
        title?: string;
        detail?: string;
        persistent?: boolean;
        judge?: JudgeVerdict;
      };
    }
  | { event: "judge"; data: JudgeNote }
  | { event: "question-request"; data: AgentQuestionRequest }
  | { event: "secret-request"; data: AgentSecretRequest }
  | { event: "run"; data: { id: string } }
  | { event: "checkpoint"; data: { tail: string } }
  | { event: "worktree"; data: { id: string; branch: string } }
  | { event: "session"; data: AgentSessionRef }
  | { event: "commands"; data: { commands: AgentCommand[] } }
  | { event: "context"; data: AgentContext }
  | { event: "usage"; data: AgentUsage }
  | { event: "controls"; data: { controls: AgentControl[] } }
  | {
      event: "status";
      data: { phase: string; provider?: string; model?: string; attempt?: number };
    }
  | { event: "input"; data: { text: string; inputId?: string } }
  | { event: "text"; data: { text: string } }
  | {
      event: "tool";
      data: { id: string; name: string; input: unknown; kind?: string; parent?: string };
    }
  | { event: "tool-output"; data: { id: string; chunk: string } }
  | { event: "tool-result"; data: { id: string; name: string; output?: unknown; error?: string } }
  | { event: "task"; data: AgentTaskPatch }
  | { event: "thought"; data: { text: string } }
  | { event: "project"; data: Project }
  | { event: "done"; data: { text: string; stopped?: "steps" | "loop" | "tokens" | "time" } }
  | { event: "error"; data: { error: string } };
