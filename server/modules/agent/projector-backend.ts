import { isStepCount, streamText, type ModelMessage } from "ai";
import type { Project } from "../projects/index.ts";
import { createAgentTools } from "./agent-tools.ts";
import { AGENT_SYSTEM_PROMPT } from "./prompts.ts";
import {
  createQwenOpenAI,
  envFallbackFromProcess,
  resolveOpenAIProvider,
} from "../providers/index.ts";
import type { AgentBackend, AgentRunOptions } from "./backend.ts";

async function run(options: AgentRunOptions): Promise<void> {
  const resolved = await resolveOpenAIProvider({
    providerId: options.providerId,
    fallback: envFallbackFromProcess(),
  });
  const provider = createQwenOpenAI({
    openaiUrl: resolved.url,
    openaiApiKey: resolved.apiKey,
  });
  const model = provider.chatModel(resolved.model || "qwen3.8-flash");

  const added: Project[] = [];
  const tools = createAgentTools({
    cwd: options.cwd,
    commands: options.commands,
    signal: options.abort,
    onProject: (project) => {
      added.push(project);
      options.emit("project", project);
    },
  });

  const history = (options.history ?? []).slice(-10);
  const messages: ModelMessage[] = [
    ...history.map((item) => ({
      role: item.role,
      content: item.content,
    })),
    { role: "user" as const, content: options.message },
  ];

  options.emit("status", {
    phase: "thinking",
    provider: resolved.name,
    model: resolved.model,
  });

  const result = streamText({
    model,
    system: AGENT_SYSTEM_PROMPT + (options.cwd ? `\nТекущий проект: ${options.cwd}` : ""),
    messages,
    tools,
    stopWhen: isStepCount(16),
    abortSignal: options.abort,
    providerOptions: {
      qwenOpenai: {
        enable_thinking: true,
      },
    },
  });

  let text = "";
  for await (const part of result.fullStream) {
    if (part.type === "text-delta") {
      text += part.text;
      options.emit("text", { text: part.text });
      continue;
    }
    if (part.type === "tool-call") {
      options.emit("tool", {
        id: part.toolCallId,
        name: part.toolName,
        input: part.input,
      });
      continue;
    }
    if (part.type === "tool-result") {
      options.emit("tool-result", {
        id: part.toolCallId,
        name: part.toolName,
        output: part.output,
      });
      continue;
    }
    if (part.type === "tool-error") {
      options.emit("tool-result", {
        id: part.toolCallId,
        name: part.toolName,
        error: part.error instanceof Error ? part.error.message : String(part.error),
      });
      continue;
    }
    if (part.type === "error") {
      const message = part.error instanceof Error ? part.error.message : "Ошибка агента";
      options.emit("error", { error: message });
      return;
    }
  }

  options.emit("done", {
    text: text.trim(),
    added: added.map((item) => item.id),
  });
}

/** The Projector IDE assistant on the active OpenAI-compatible provider. */
export const projectorBackend: AgentBackend = { id: "projector", run };
