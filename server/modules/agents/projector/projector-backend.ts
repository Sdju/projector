import type { AgentBackend, AgentRunOptions, AgentControl } from "../../agent/index.ts";
import {
  defaultSettingsMiddleware,
  streamText,
  wrapLanguageModel,
  type LanguageModel,
  type ModelMessage,
} from "ai";
import type { Project } from "../../projects/index.ts";
import { createAgentTools } from "./agent-tools.ts";
import { buildSystemPrompt } from "./prompts.ts";
import { widgetCatalog } from "./widgets.ts";
import {
  createQwenOpenAI,
  envFallbackFromProcess,
  loadPublicProviders,
  quietThinkingBody,
  resolveOpenAIProvider,
  thinkingBody,
  thinkingLevel,
  thinkingOptions,
} from "../../providers/index.ts";
import { tokensOf, type Tokens } from "./projector-usage.ts";
import { budgetNote, turnBudget } from "./projector-budget.ts";
import { isRetryable, MAX_RETRIES, pause, retryDelay } from "./projector-retry.ts";
import { projectInstructions } from "./project-instructions.ts";
import { createBashReviewer } from "./projector-review.ts";
import { toMessages, userMessage } from "./projector-history.ts";
import {
  COMPACT_COMMAND,
  compactHistory,
  splitAtCompaction,
  summarize,
  summarySection,
} from "./projector-compaction.ts";

/** The window of a model that has none registered in the provider settings; the context ring is measured against it. */
const DEFAULT_CONTEXT_SIZE = Number(process.env.PROJECTOR_AGENT_CONTEXT_TOKENS) || 128_000;
const TRUST = "permission-mode";
const MODES = new Set(["default", "auto", "bypassPermissions"]);
const THINKING = "thinking";

async function run(options: AgentRunOptions): Promise<void> {
  const [providerId, ...rest] = (options.selection?.provider || options.providerId || "").split(
    ":",
  );
  const resolved = await resolveOpenAIProvider({
    providerId,
    model: rest.join(":"),
    fallback: envFallbackFromProcess(),
  });
  const provider = createQwenOpenAI({
    openaiUrl: resolved.url,
    openaiApiKey: resolved.apiKey,
  });
  const model = provider.chatModel(resolved.model);
  const style = resolved.thinking === false ? "none" : resolved.thinkingStyle;
  // The side requests (summary, command review) never think; the answer itself follows the chat's choice.
  const quiet = quietThinkingBody(style);
  const quietModel = quiet
    ? wrapLanguageModel({
        model,
        middleware: defaultSettingsMiddleware({
          settings: { providerOptions: { qwenOpenai: quiet } },
        }),
      })
    : model;

  const mode = options.selection?.[TRUST] ?? options.permissionMode;
  const added: Project[] = [];
  const tools = createAgentTools({
    cwd: options.cwd,
    commands: options.commands,
    signal: options.abort,
    ask: options.ask,
    secret: options.secret,
    guard: {
      cwd: options.cwd,
      approve: options.approve,
      trusting: mode === "bypassPermissions",
      review:
        mode === "auto" ? createBashReviewer(quietModel, options.cwd, options.abort) : undefined,
    },
    onProject: (project) => {
      added.push(project);
      options.emit("project", project);
    },
  });

  const earlier = splitAtCompaction(options.history ?? []);
  if (options.message.trim() === COMPACT_COMMAND) {
    await compactChat(quietModel, earlier, options, resolved);
    return;
  }
  const { recent, summary } = await compactHistory(quietModel, earlier.turns, {
    signal: options.abort,
    base: earlier.summary,
    onStart: () => options.emit("status", { phase: "compacting" }),
  });
  const messages: ModelMessage[] = [
    ...toMessages(recent),
    await userMessage(options.message, options.parts),
  ];

  options.emit("status", {
    phase: "thinking",
    provider: resolved.name,
    model: resolved.model,
  });
  options.emit("controls", { controls: await controls(options.selection ?? {}) });

  const system =
    buildSystemPrompt(widgetCatalog.guide()) +
    (options.cwd ? `\nТекущий проект: ${options.cwd}` : "") +
    (await projectInstructions(options.cwd)) +
    summarySection(summary);

  const budget = turnBudget();
  const wanted = options.selection?.[THINKING];
  let answering = model;
  let thinking = thinkingBody(style, wanted);
  let fallback = resolved.fallback;
  let text = "";
  /** What the first request of the answer found in the provider cache. */
  let firstRequest: Tokens | undefined;
  let result: ReturnType<typeof streamText<typeof tools>>;
  // A request that fails before the model said anything is repeated; later the turn would replay.
  for (let attempt = 0; ; attempt++) {
    result = streamText({
      model: answering,
      system,
      messages,
      tools,
      stopWhen: budget.stopWhen,
      abortSignal: options.abort,
      maxRetries: 0,
      providerOptions: thinking ? { qwenOpenai: thinking } : undefined,
    });

    let started = false;
    let failure: unknown;
    firstRequest = undefined;
    for await (const part of result.fullStream) {
      if (part.type === "error") {
        failure = part.error;
        break;
      }
      if (part.type === "text-delta") {
        started = true;
        text += part.text;
        options.emit("text", { text: part.text });
      } else if (part.type === "reasoning-delta") {
        started = true;
        options.emit("thought", { text: part.text });
      } else if (part.type === "tool-call") {
        started = true;
        options.emit("tool", {
          id: part.toolCallId,
          name: part.toolName,
          input: part.input,
        });
      } else if (part.type === "finish-step") {
        firstRequest ??= tokensOf(part.usage);
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
    if (failure === undefined) break;
    if (!started && attempt < MAX_RETRIES && !options.abort?.aborted && isRetryable(failure)) {
      const delay = retryDelay(attempt, failure);
      options.emit("status", { phase: "retrying", attempt: attempt + 1, delay });
      await pause(delay, options.abort);
      if (!options.abort?.aborted) continue;
    }
    // The model keeps failing: the fallback of the provider answers instead, once.
    if (!started && fallback && !options.abort?.aborted && isRetryable(failure)) {
      options.emit("status", {
        phase: "fallback",
        model: fallback.modelName,
        provider: resolved.name,
      });
      answering = provider.chatModel(fallback.model);
      thinking = thinkingBody(fallback.thinking === false ? "none" : style, wanted);
      fallback = undefined;
      attempt = -1;
      continue;
    }
    const message = failure instanceof Error ? failure.message : "Ошибка агента";
    options.emit("error", { error: message });
    return;
  }

  try {
    // Providers that cache the prompt prefix report it; the chat shows the share served from cache.
    const total = tokensOf(await result.totalUsage);
    if (total.input + total.cacheRead + total.cacheWrite + total.output)
      options.emit("usage", { ...total, first: firstRequest });
  } catch {
    // No usage, no tooltip.
  }
  // The last request carried the whole conversation, so its size is how full the context is.
  try {
    const usage = await result.usage;
    const used = (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0);
    if (used)
      options.emit("context", {
        used,
        size: resolved.contextTokens ?? DEFAULT_CONTEXT_SIZE,
        model: resolved.model,
      });
  } catch {
    // The indicator keeps its previous value.
  }
  const stopped =
    (await result.finishReason) === "tool-calls" ? (budget.reason() ?? "steps") : undefined;
  if (stopped) {
    const note = budgetNote(budget.reason());
    text += note;
    options.emit("text", { text: note });
  }

  options.emit("done", {
    text: text.trim(),
    added: added.map((item) => item.id),
    stopped,
  });
}

/** `/compact`: the answer is the summary of the whole chat, and what follows it builds on that. */
async function compactChat(
  model: LanguageModel,
  earlier: ReturnType<typeof splitAtCompaction>,
  options: AgentRunOptions,
  resolved: { model: string; contextTokens?: number },
): Promise<void> {
  options.emit("status", { phase: "compacting" });
  const summary = earlier.turns.length
    ? await summarize(model, earlier.summary, earlier.turns, options.abort)
    : earlier.summary;
  if (!summary) {
    options.emit("error", { error: "Пока нечего сжимать" });
    return;
  }
  options.emit("text", { text: summary });
  // The next request measures the real size; until then the ring shows about what the summary takes.
  options.emit("context", {
    used: Math.ceil((summary.length + 6_000) / 3),
    size: resolved.contextTokens ?? DEFAULT_CONTEXT_SIZE,
    model: resolved.model,
  });
  options.emit("done", { text: summary, added: [] });
}

/** The providers to choose from and whether the agent asks before changing things. */
async function controls(selection: Record<string, string> = {}): Promise<AgentControl[]> {
  const { providers, activeProviderId } = await loadPublicProviders(envFallbackFromProcess());
  const list: AgentControl[] = [
    {
      id: TRUST,
      via: "native",
      category: "mode",
      name: "Разрешения",
      description: "Когда агент спрашивает перед командами оболочки и правками в Projector",
      current: MODES.has(selection[TRUST]!) ? selection[TRUST]! : "default",
      options: [
        { value: "default", name: "Спрашивать", description: "Подтверждение перед изменениями" },
        {
          value: "auto",
          name: "Авто",
          description:
            "Безопасные команды оболочки выполняются сразу — их проверяет отдельный запрос к модели, остальное подтверждается",
        },
        { value: "bypassPermissions", name: "Без вопросов" },
      ],
    },
  ];
  // One option per registered model of every enabled provider; `provider:alias` picks both.
  const options = providers
    .filter((item) => item.enabled && item.url)
    .flatMap((item) =>
      item.models.length
        ? item.models.map((model) => ({
            value: `${item.id}:${model.alias}`,
            name: `${item.name} · ${model.alias}`,
          }))
        : [{ value: item.id, name: item.name }],
    );
  if (options.length) {
    const wanted = selection.provider ?? "";
    const byProvider = (id: string) => options.find((item) => item.value.split(":")[0] === id);
    // A bare provider id (older chats) means its first model; an unknown choice, the default provider.
    const current =
      options.find((item) => item.value === wanted) ??
      byProvider(wanted) ??
      byProvider(activeProviderId ?? "") ??
      options[0]!;
    const [providerId, ...alias] = current.value.split(":");
    const chosen = providers.find((item) => item.id === providerId);
    const model =
      chosen?.models.find((item) => item.alias === alias.join(":")) ?? chosen?.models[0];
    const style = model?.thinking === false || !chosen ? "none" : chosen.thinkingStyle;
    const levels = thinkingOptions(style);
    if (levels.length)
      list.push({
        id: THINKING,
        via: "native",
        category: "effort",
        name: "Размышление",
        description: "Насколько модель думает перед ответом; без него ответ быстрее и дешевле",
        current: thinkingLevel(style, selection[THINKING]),
        options: levels,
      });
    list.unshift({
      id: "provider",
      via: "native",
      category: "model",
      name: "Модель",
      description: "Провайдер и модель из настроек",
      current: current.value,
      options,
    });
  }
  return list;
}

/** The Projector IDE assistant on the active OpenAI-compatible provider. */
export const projectorBackend: AgentBackend = {
  id: "projector",
  capabilities: { compact: { command: COMPACT_COMMAND, hintAt: 0.8, autoAt: 0.9 } },
  controls: () => controls(),
  run,
};
