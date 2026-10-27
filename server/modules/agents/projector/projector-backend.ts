import { runHostedAgent, type AgentBackend, type AgentRunOptions } from "../../agent/index.ts";
import { fileURLToPath } from "node:url";
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
  quietThinkingBody,
  resolveOpenAIProvider,
  thinkingBody,
} from "../../providers/index.ts";
import {
  contextOf,
  costOf,
  tokensOf,
  type Price,
  type SdkUsage,
  type Tokens,
} from "./projector-usage.ts";
import { budgetNote, turnBudget } from "./projector-budget.ts";
import { isRetryable, MAX_RETRIES, pause, retryDelay } from "./projector-retry.ts";
import { connectMcp, mcpSection } from "./projector-mcp.ts";
import { expandSlash, listSkills, skillsSection } from "./projector-skills.ts";
import { memorySection } from "./projector-memory.ts";
import { loadHooks, runStopHooks, withHooks } from "./projector-hooks.ts";
import { projectInstructions } from "./project-instructions.ts";
import { createBashReviewer } from "./projector-review.ts";
import { controls, THINKING, TRUST } from "./projector-controls.ts";
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

/** The runner process of a hosted answer (the composition root, which also registers the widgets). */
const RUNNER = fileURLToPath(new URL("../../../app/projector-runner.ts", import.meta.url));

/** The run: held by its own process when the route gave it one, otherwise in this process. */
async function run(options: AgentRunOptions): Promise<void> {
  if (!options.run) return runProjector(options);
  // The runner reads the provider keys itself, so it gets the server's environment; the shell
  // tool drops anything that looks like a secret before it starts a command.
  await runHostedAgent(options, options.run, {
    runner: RUNNER,
    cwd: options.cwd || process.cwd(),
    env: { ...process.env },
  });
}

/** MCP servers live for one turn: whatever the turn started is stopped however it ends. */
export async function runProjector(options: AgentRunOptions): Promise<void> {
  const open = { close: async () => {} };
  try {
    await turn(options, open);
  } finally {
    await open.close();
  }
}

async function turn(options: AgentRunOptions, open: { close: () => Promise<void> }): Promise<void> {
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
  const guard = {
    cwd: options.cwd,
    approve: options.approve,
    trusting: mode === "bypassPermissions",
    review:
      mode === "auto" ? createBashReviewer(quietModel, options.cwd, options.abort) : undefined,
  };
  const own = createAgentTools({
    cwd: options.cwd,
    commands: options.commands,
    signal: options.abort,
    ask: options.ask,
    secret: options.secret,
    guard,
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
  const skills = await listSkills(options.cwd);
  const { recent, summary } = await compactHistory(quietModel, earlier.turns, {
    signal: options.abort,
    base: earlier.summary,
    onStart: () => options.emit("status", { phase: "compacting" }),
  });
  const mcp = await connectMcp(options.cwd, guard, options.abort);
  open.close = mcp.close;
  const hooks = await loadHooks(options.cwd, guard);
  const started = Date.now();
  const tools = withHooks({ ...mcp.tools, ...own }, hooks, options.cwd) as typeof own;
  const messages: ModelMessage[] = [
    ...toMessages(recent),
    await userMessage(expandSlash(options.message, skills), options.parts),
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
    (await memorySection(options.cwd)) +
    mcpSection(mcp) +
    skillsSection(skills) +
    summarySection(summary);

  const budget = turnBudget();
  const wanted = options.selection?.[THINKING];
  let answering = model;
  let thinking = thinkingBody(style, wanted);
  let fallback = resolved.fallback;
  let price: Price | undefined = resolved.price;
  let text = "";
  /** What the first request of the answer found in the provider cache. */
  let firstRequest: Tokens | undefined;
  /** One entry per model request of the successful attempt; the last one fills the context window. */
  let requests: SdkUsage[] = [];
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
    requests = [];
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
      price = fallback.price;
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
      options.emit("usage", {
        ...total,
        first: firstRequest,
        ...(price ? { cost: costOf(total, price) } : {}),
      });
  } catch {
    // No usage, no tooltip.
  }
  // `result.usage` sums every step, and each step resends the conversation, so that sum
  // counts the same prefix again. The last request is the window.
  const used = contextOf(requests);
  if (used)
    options.emit("context", {
      used,
      size: resolved.contextTokens ?? DEFAULT_CONTEXT_SIZE,
      model: resolved.model,
    });
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
  await runStopHooks(hooks, options.cwd, { seconds: (Date.now() - started) / 1000, text });
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

/** The Projector IDE assistant on the active OpenAI-compatible provider. */
export const projectorBackend: AgentBackend = {
  id: "projector",
  capabilities: { hosted: true, compact: { command: COMPACT_COMMAND, hintAt: 0.8, autoAt: 0.9 } },
  controls: () => controls(),
  commands: async (cwd) => [
    { name: COMPACT_COMMAND.slice(1), description: "Сжать историю разговора в сводку" },
    ...(await listSkills(cwd || undefined)).map((item) => ({
      name: item.name,
      description: item.description,
      hint: item.hint,
    })),
  ],
  run,
};
