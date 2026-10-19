import type { AgentBackend, AgentRunOptions, AgentControl } from "../../agent/index.ts";
import { isStepCount, streamText, type ModelMessage } from "ai";
import type { Project } from "../../projects/index.ts";
import { createAgentTools } from "./agent-tools.ts";
import { buildSystemPrompt } from "./prompts.ts";
import { widgetCatalog } from "./widgets.ts";
import {
  createQwenOpenAI,
  envFallbackFromProcess,
  loadPublicProviders,
  resolveOpenAIProvider,
} from "../../providers/index.ts";
import { createBashReviewer } from "./projector-review.ts";
import { historyMessages, userMessage } from "./projector-history.ts";

const MAX_STEPS = 24;
/** The window of a provider's model is not reported; this is what the context ring is measured against. */
const CONTEXT_SIZE = Number(process.env.PROJECTOR_AGENT_CONTEXT_TOKENS) || 128_000;
const TRUST = "permission-mode";
const MODES = new Set(["default", "auto", "bypassPermissions"]);

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
      review: mode === "auto" ? createBashReviewer(model, options.cwd, options.abort) : undefined,
    },
    onProject: (project) => {
      added.push(project);
      options.emit("project", project);
    },
  });

  const messages: ModelMessage[] = [
    ...historyMessages(options.history ?? []),
    await userMessage(options.message, options.parts),
  ];

  options.emit("status", {
    phase: "thinking",
    provider: resolved.name,
    model: resolved.model,
  });
  options.emit("controls", { controls: await controls(options.selection ?? {}) });

  const result = streamText({
    model,
    system:
      buildSystemPrompt(widgetCatalog.guide()) +
      (options.cwd ? `\nТекущий проект: ${options.cwd}` : ""),
    messages,
    tools,
    stopWhen: isStepCount(MAX_STEPS),
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
    if (part.type === "reasoning-delta") {
      options.emit("thought", { text: part.text });
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

  // The last request carried the whole conversation, so its size is how full the context is.
  try {
    const usage = await result.usage;
    const used = (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0);
    if (used) options.emit("context", { used, size: CONTEXT_SIZE, model: resolved.model });
  } catch {
    // The indicator keeps its previous value.
  }
  if ((await result.finishReason) === "tool-calls") {
    const note = `\n\nЯ остановился на ${MAX_STEPS} шагах. Напишите «продолжай», чтобы я пошёл дальше.`;
    text += note;
    options.emit("text", { text: note });
  }

  options.emit("done", {
    text: text.trim(),
    added: added.map((item) => item.id),
  });
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
  controls: () => controls(),
  run,
};
