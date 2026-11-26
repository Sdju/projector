import { streamText, type ModelMessage, type StepResult, type ToolSet } from "ai";
import { failureFromError, type AgentRunOptions } from "../../agent/index.ts";
import {
  thinkingBody,
  type createQwenOpenAI,
  type resolveOpenAIProvider,
} from "../../providers/index.ts";
import type { createTurnInput } from "./projector-input.ts";
import type { turnBudget } from "./projector-budget.ts";
import { tokensOf, type Price, type SdkUsage, type Tokens } from "./projector-usage.ts";
import { isRetryable, MAX_RETRIES, pause, retryDelay } from "./projector-retry.ts";

type ChatModel = ReturnType<ReturnType<typeof createQwenOpenAI>["chatModel"]>;

export async function streamProjectorAnswer<Tools extends ToolSet>({
  model,
  fallbackModel,
  resolved,
  style,
  wanted,
  system,
  messages,
  tools,
  input,
  budget,
  options,
}: {
  model: ChatModel;
  fallbackModel: (id: string) => ChatModel;
  resolved: Awaited<ReturnType<typeof resolveOpenAIProvider>>;
  style: Parameters<typeof thinkingBody>[0];
  wanted: Parameters<typeof thinkingBody>[1];
  system: string;
  messages: ModelMessage[];
  tools: Tools;
  input: ReturnType<typeof createTurnInput>;
  budget: ReturnType<typeof turnBudget>;
  options: Pick<AgentRunOptions, "abort" | "emit">;
}) {
  let answering = model;
  let thinking = thinkingBody(style, wanted);
  let fallback = resolved.fallback;
  let price: Price | undefined = resolved.price;
  let text = "";
  /** What the first request of the answer found in the provider cache. */
  let firstRequest: Tokens | undefined;
  /** One entry per model request of the successful attempt; the last one fills the context window. */
  const requests: SdkUsage[] = [];
  let result: ReturnType<typeof streamText<typeof tools>>;
  const steps: StepResult<typeof tools>[] = [];
  let startedAnswer = false;
  // A request that fails before the model said anything is repeated; later the turn would replay.
  for (let attempt = 0; ; attempt++) {
    messages.push(...input.take());
    result = streamText({
      model: answering,
      system,
      messages,
      tools,
      // Run one model step at a time so additions also get a turn after a text-only answer.
      stopWhen: () => true,
      abortSignal: options.abort,
      maxRetries: 0,
      providerOptions: thinking ? { qwenOpenai: thinking } : undefined,
    });

    let failure: unknown;
    for await (const part of result.fullStream) {
      if (part.type === "error") {
        failure = part.error;
        break;
      }
      if (part.type === "text-delta") {
        startedAnswer = true;
        text += part.text;
        options.emit("text", { text: part.text });
      } else if (part.type === "reasoning-delta") {
        startedAnswer = true;
        options.emit("thought", { text: part.text });
      } else if (part.type === "tool-call") {
        startedAnswer = true;
        options.emit("tool", {
          id: part.toolCallId,
          name: part.toolName,
          input: part.input,
        });
      } else if (part.type === "finish-step") {
        firstRequest ??= tokensOf(part.usage);
        requests.push(part.usage);
      } else if (part.type === "tool-result") {
        options.emit("tool-result", {
          id: part.toolCallId,
          name: part.toolName,
          output: part.output,
        });
      } else if (part.type === "tool-error") {
        options.emit("tool-result", {
          id: part.toolCallId,
          name: part.toolName,
          error: part.error instanceof Error ? part.error.message : String(part.error),
        });
      }
    }
    if (failure === undefined) {
      messages.push(...(await result.response).messages);
      steps.push(...(await result.steps));
      const continuing = (await result.finishReason) === "tool-calls" || input.pending;
      const aborted = options.abort?.aborted === true;
      const overBudget =
        (continuing || aborted) &&
        (await Promise.all(budget.stopWhen.map(async (stop) => stop({ steps })))).some(Boolean);
      if (overBudget || aborted || !continuing) break;
      attempt = -1;
      continue;
    }
    if (
      !startedAnswer &&
      attempt < MAX_RETRIES &&
      !options.abort?.aborted &&
      isRetryable(failure)
    ) {
      const delay = retryDelay(attempt, failure);
      options.emit("status", { phase: "retrying", attempt: attempt + 1, delay });
      await pause(delay, options.abort);
      if (!options.abort?.aborted) continue;
    }
    // The model keeps failing: the fallback of the provider answers instead, once.
    if (!startedAnswer && fallback && !options.abort?.aborted && isRetryable(failure)) {
      options.emit("status", {
        phase: "fallback",
        model: fallback.modelName,
        provider: resolved.name,
      });
      answering = fallbackModel(fallback.model);
      thinking = thinkingBody(fallback.thinking === false ? "none" : style, wanted);
      price = fallback.price;
      fallback = undefined;
      attempt = -1;
      continue;
    }
    const failureInfo = failureFromError(failure);
    options.emit("error", { error: failureInfo.message, failure: failureInfo });
    return undefined;
  }

  return { text, requests, firstRequest, price };
}
