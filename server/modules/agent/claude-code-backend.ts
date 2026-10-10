import { query } from "@anthropic-ai/claude-agent-sdk";
import type {
  Options,
  SDKControlGetContextUsageResponse as ContextUsage,
  SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { createInput, registerInjector } from "./claude-code-input.ts";
import { agentEnv, assertHostProject, attachedImages, promptWithHistory } from "./agent-host.ts";
import type { AgentBackend, AgentCommand, AgentRunOptions } from "./backend.ts";
import { CLAUDE_LABEL, createClaudeEventMapper } from "./claude-code-events.ts";
import {
  chainTail,
  claudeMcpServers,
  isUuid,
  rewindClaudeFiles,
  sessionAt,
} from "./claude-code-checkpoints.ts";
import {
  CLAUDE_CONTROLS,
  claudeLoadSession,
  claudeSessions,
  claudeUpdateSession,
} from "./claude-code-sessions.ts";
import type { AgentControl } from "./controls.ts";

/** Claude Code takes the choice natively; `default` leaves the model and effort to its settings. */
function chosen(options: AgentRunOptions) {
  const pick = (id: string) => {
    const value = options.selection?.[id];
    return value && value !== "default" ? value : undefined;
  };
  const number = (id: string) => {
    const value = Number(pick(id));
    return Number.isFinite(value) && value > 0 ? value : undefined;
  };
  return {
    model: pick("model"),
    effort: pick("effort"),
    budget: number("budget"),
    steps: number("steps"),
  };
}

/**
 * Plain Claude Code behind a chat UI instead of the TUI: its own prompt, tools, login, `CLAUDE.md`
 * and settings. Nothing about Projector is added to the model's context.
 */
async function run(options: AgentRunOptions): Promise<void> {
  if (!options.cwd) throw new Error("Claude Code работает внутри проекта: откройте чат в проекте");
  const cwd = options.cwd;
  await assertHostProject(cwd, CLAUDE_LABEL);

  const abortController = new AbortController();
  const forwardAbort = () => abortController.abort();
  if (options.abort?.aborted) abortController.abort();
  else options.abort?.addEventListener("abort", forwardAbort, { once: true });

  const mode = options.permissionMode ?? "default";
  const selected = chosen(options);
  const base: Options = {
    cwd,
    abortController,
    env: agentEnv(),
    includePartialMessages: true,
    settingSources: ["user", "project", "local"],
    systemPrompt: { type: "preset", preset: "claude_code" },
    permissionMode: mode,
    // Files are backed up before the agent changes them, so a step can be taken back later.
    enableFileCheckpointing: true,
    ...(selected.model ? { model: selected.model } : {}),
    ...(selected.effort ? { effort: selected.effort as Options["effort"] } : {}),
    ...(selected.budget ? { maxBudgetUsd: selected.budget } : {}),
    ...(selected.steps ? { maxTurns: selected.steps } : {}),
    ...(mode === "bypassPermissions" ? { allowDangerouslySkipPermissions: true } : {}),
    canUseTool: async (toolName, input, context) => {
      if (!options.approve)
        return { behavior: "deny", message: "Клиент не может показать запрос разрешения" };
      const suggestions = context.suggestions ?? [];
      const answer = await options
        .approve({
          tool: toolName,
          input,
          title: context.title ?? context.displayName,
          persistent: suggestions.length > 0,
        })
        .catch(() => false);
      if (!answer) return { behavior: "deny", message: "Пользователь отклонил действие" };
      // "Always" turns the rule Claude Code itself suggests into a saved permission.
      return {
        behavior: "allow",
        updatedInput: input,
        ...(answer === "always" && suggestions.length ? { updatedPermissions: suggestions } : {}),
      };
    },
  };

  const attempt = async (resume: string | undefined) => {
    // A failed resume is retried silently, so its error is held back until we know it is final.
    let heldError: unknown;
    const emit: AgentRunOptions["emit"] = (event, data) => {
      if (resume && event === "error") heldError = data;
      else options.emit(event, data);
    };
    const mapper = createClaudeEventMapper(emit);
    const prompt = resume
      ? options.message
      : promptWithHistory(options.message, options.history ?? []);
    const images = await attachedImages(options.parts);
    const messageId = isUuid(options.messageId) ? options.messageId : undefined;
    const input = createInput(userMessage(prompt, images, messageId));
    const unregister = messageId
      ? registerInjector(messageId, (text) => input.push(text))
      : undefined;
    const conversation = query({
      prompt: input.stream,
      options: { ...base, ...(resume ? { resume } : {}) },
    });
    try {
      for await (const message of conversation) {
        mapper.handle(message);
        if (message.type === "result") {
          await emitContext(conversation, emit);
          input.settled();
        } else if (message.type === "assistant" || message.type === "stream_event") input.busy();
      }
    } finally {
      unregister?.();
      input.close();
      conversation.close();
    }
    // Where this answer ends in the transcript: the next message can branch off here.
    if (!mapper.failed && mapper.sessionId) {
      const tail = await chainTail(cwd, mapper.sessionId);
      if (tail) options.emit("checkpoint", { tail });
    }
    // The session may be gone (project moved, transcript pruned): start over from the history.
    if (resume && mapper.failed && !mapper.started && !abortController.signal.aborted)
      return attempt(undefined);
    if (heldError) options.emit("error", heldError);
  };

  try {
    options.emit("controls", { controls: claudeControls(options.selection ?? {}) });
    options.emit("status", { phase: "thinking", provider: CLAUDE_LABEL, model: "" });
    const resume = options.sessionId
      ? await sessionAt(cwd, options.sessionId, options.tail)
      : undefined;
    await attempt(resume);
  } finally {
    options.abort?.removeEventListener("abort", forwardAbort);
  }
}

/**
 * The prompt as one streamed user message: text and images as content blocks, and an ID of our own
 * that the transcript keeps, which is what a later rewind of the files refers to.
 */
function userMessage(
  text: string,
  images: { mime: string; data: string }[],
  uuid: string | undefined,
): SDKUserMessage {
  return {
    type: "user",
    ...(uuid ? { uuid: uuid as SDKUserMessage["uuid"] } : {}),
    parent_tool_use_id: null,
    message: {
      role: "user",
      content: [
        { type: "text", text },
        ...images.map((image) => ({
          type: "image" as const,
          source: {
            type: "base64" as const,
            media_type: image.mime as "image/png" | "image/jpeg" | "image/gif" | "image/webp",
            data: image.data,
          },
        })),
      ],
    },
  };
}

const COMMANDS_TTL_MS = 60_000;
const commandCache = new Map<string, { at: number; commands: Promise<AgentCommand[]> }>();

/**
 * The slash commands (built in, user's, project's, plugins', skills') Claude Code offers in a
 * folder. They are only known to a running session, so one is started without a prompt, asked and
 * closed; the answer is kept for a minute.
 */
function claudeCommands(cwd: string): Promise<AgentCommand[]> {
  const cached = commandCache.get(cwd);
  if (cached && Date.now() - cached.at < COMMANDS_TTL_MS) return cached.commands;
  const commands = (async () => {
    const idle = (async function* (): AsyncGenerator<SDKUserMessage> {
      await new Promise<never>(() => {});
    })();
    const session = query({
      prompt: idle,
      options: { cwd, env: agentEnv(), settingSources: ["user", "project", "local"] },
    });
    try {
      return (await session.supportedCommands()).map((item) => ({
        name: item.name,
        description: item.description || undefined,
        hint: item.argumentHint || undefined,
      }));
    } finally {
      session.close();
    }
  })();
  commandCache.set(cwd, { at: Date.now(), commands });
  commands.catch(() => commandCache.delete(cwd));
  return commands;
}

/** How full the context window is after the turn; a failure only means no indicator. */
async function emitContext(
  conversation: { getContextUsage(options: { detail: "summary" }): Promise<ContextUsage> },
  emit: AgentRunOptions["emit"],
): Promise<void> {
  try {
    const usage = await conversation.getContextUsage({ detail: "summary" });
    emit("context", {
      used: usage.totalTokens,
      size: usage.maxTokens,
      model: usage.model,
      compactAt: usage.isAutoCompactEnabled ? usage.autoCompactThreshold : undefined,
      categories: usage.categories
        .filter((item) => item.kind === "used" && item.tokens > 0)
        .map((item) => ({ name: item.name, tokens: item.tokens })),
    });
  } catch {
    // The answer is already complete; the indicator just keeps its previous value.
  }
}

/** The static list with the user's current choice marked. */
function claudeControls(selection: Record<string, string>): AgentControl[] {
  return CLAUDE_CONTROLS.map((control) => {
    const value = selection[control.id];
    return value && control.options.some((option) => option.value === value)
      ? { ...control, current: value }
      : control;
  });
}

export const claudeCodeBackend: AgentBackend = {
  id: "claude-code",
  run,
  controls: async () => CLAUDE_CONTROLS,
  commands: claudeCommands,
  sessions: claudeSessions,
  loadSession: claudeLoadSession,
  updateSession: claudeUpdateSession,
  rewindFiles: (cwd, sessionId, messageId, dryRun) =>
    rewindClaudeFiles(cwd, sessionId, messageId, dryRun),
  mcpServers: claudeMcpServers,
};
