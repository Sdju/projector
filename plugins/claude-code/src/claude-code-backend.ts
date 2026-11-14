import type {
  AgentBackend,
  AgentCommand,
  AgentControl,
  AgentRunHandle,
  AgentRunOptions,
  ClaudeSdk,
  PluginCodeApi,
} from "./api.ts";
import type {
  Options,
  SDKControlGetContextUsageResponse as ContextUsage,
  SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { createInput } from "./claude-code-input.ts";
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
  claudeDeleteSession,
  claudeUpdateSession,
} from "./claude-code-sessions.ts";
import { askClaudeQuestions } from "./questions.ts";
import { claudeEnv } from "./claude-code-env.ts";
import { processMcpConfig } from "./mcp.ts";

/** What a Claude Code answer needs from the host: the plugin API and the Agent SDK. */
export interface ClaudeDeps {
  api: PluginCodeApi;
  sdk: ClaudeSdk;
}

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

/** The answer of a hosted run: followed through the generic plugin runner. */
async function runHosted(
  deps: ClaudeDeps,
  options: AgentRunOptions,
  handle: AgentRunHandle,
): Promise<void> {
  if (!options.cwd) throw new Error("Claude Code работает внутри проекта: откройте чат в проекте");
  await deps.api.host.assertProject(options.cwd, CLAUDE_LABEL);
  await deps.api.host.runHosted(
    options,
    handle,
    "claude-code",
    isUuid(options.messageId) ? options.messageId : undefined,
  );
}

/** The run: held by its own process when the route gave it one, otherwise in this process. */
async function run(deps: ClaudeDeps, options: AgentRunOptions): Promise<void> {
  if (options.run) return runHosted(deps, options, options.run);
  return runClaudeCode(deps, options);
}

/** The prompt of a Claude Code session: its own preset plus the abilities and role switched on for the chat. */
export async function claudeSystemPrompt(
  api: PluginCodeApi,
  features?: string[],
  role = "",
  projectWidgets = "",
): Promise<Options["systemPrompt"]> {
  const text = [
    role.trim(),
    await api.features.prompt("claude-code", features),
    projectWidgets.trim(),
  ]
    .filter(Boolean)
    .join("\n\n");
  return {
    type: "preset",
    preset: "claude_code",
    ...(text ? { append: text } : {}),
    // The host changes the append when the user flips a feature: render the prompt fresh on every
    // request, otherwise a resumed session keeps the prompt recorded at its first request.
    snapshot: false,
  };
}

/**
 * Plain Claude Code behind a chat UI instead of the TUI: its own prompt, tools, login, `CLAUDE.md`
 * and settings. Nothing about Projector is added to the model's context except the abilities the
 * user switched on. Runs in the generic plugin runner (`server/app/plugin-runner.ts`) for a hosted answer,
 * and in the server process otherwise.
 */
export async function runClaudeCode(deps: ClaudeDeps, options: AgentRunOptions): Promise<void> {
  const { api, sdk } = deps;
  if (!options.cwd) throw new Error("Claude Code работает внутри проекта: откройте чат в проекте");
  const requestedMode =
    options.selection?.["permission-mode"] ?? options.permissionMode ?? "default";
  const mode = PERMISSION_MODES.find((value) => value === requestedMode);
  if (!mode) throw new Error("Неизвестный режим разрешений агента");
  const cwd = options.cwd;
  await api.host.assertProject(cwd, CLAUDE_LABEL);

  const abortController = new AbortController();
  const forwardAbort = () => abortController.abort();
  if (options.abort?.aborted) abortController.abort();
  else options.abort?.addEventListener("abort", forwardAbort, { once: true });

  const selected = chosen(options);
  const [ideEnabled, widgetsEnabled, roleText] = await Promise.all([
    api.features.enabled("claude-code", "ide", options.features),
    api.features.enabled("claude-code", "widgets", options.features),
    api.roles.context(options.role, cwd),
  ]);
  const projectWidgets = widgetsEnabled ? await api.widgets.trustedProject(options.projectId) : [];
  const ideServer = options.projectId ? api.mcp.ide(options.projectId) : undefined;
  // The SDK takes an explicit server inline; `alwaysLoad` keeps its tools out of tool search.
  const extraMcp =
    ideEnabled && ideServer
      ? {
          [ideServer.name]: {
            type: "stdio" as const,
            command: ideServer.command,
            args: ideServer.args,
            env: ideServer.env,
            alwaysLoad: true,
          },
        }
      : {};
  // A role with its own MCP list gets exactly those servers: Claude Code must not add the rest.
  const namedMcp = options.role?.mcp
    ? Object.fromEntries(
        api.mcp
          .byNames(await api.mcp.configs(cwd), options.role.mcp)
          .filter((config) => !(config.name in extraMcp))
          .map((config) => [config.name, processMcpConfig(config)]),
      )
    : {};
  const mcpServers = { ...namedMcp, ...extraMcp } as unknown as NonNullable<Options["mcpServers"]>;
  const base: Options = {
    cwd,
    abortController,
    env: claudeEnv(api),
    ...(Object.keys(mcpServers).length ? { mcpServers } : {}),
    ...(options.role?.mcp ? { strictMcpConfig: true } : {}),
    includePartialMessages: true,
    // A background subagent streams no calls of its own: its progress arrives as these summaries.
    agentProgressSummaries: true,
    settingSources: ["user", "project", "local"],
    systemPrompt: await claudeSystemPrompt(
      api,
      options.features,
      roleText,
      projectWidgets.length ? api.widgets.guide(projectWidgets) : "",
    ),
    permissionMode: mode,
    // Files are backed up before the agent changes them, so a step can be taken back later.
    enableFileCheckpointing: true,
    ...(selected.model ? { model: selected.model } : {}),
    ...(selected.effort ? { effort: selected.effort as Options["effort"] } : {}),
    ...(selected.budget ? { maxBudgetUsd: selected.budget } : {}),
    ...(selected.steps ? { maxTurns: selected.steps } : {}),
    ...(mode === "bypassPermissions" ? { allowDangerouslySkipPermissions: true } : {}),
    canUseTool: async (toolName, input, context) => {
      if (toolName === "AskUserQuestion") return askClaudeQuestions(options, input);
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
        ...(answer === "always" && suggestions.length
          ? {
              // Kept in the user's own settings, so it holds in every project and for the terminal too.
              updatedPermissions: suggestions.map((rule) => ({
                ...rule,
                destination: "userSettings" as const,
              })),
            }
          : {}),
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
      : api.host.promptWithHistory(options.message, options.history ?? []);
    const images = await api.host.attachedImages(options.parts);
    const messageId = isUuid(options.messageId) ? options.messageId : undefined;
    const input = createInput(userMessage(prompt, images, messageId));
    const unregister = messageId
      ? api.host.registerInjector(messageId, (text, inputId) => {
          const accepted = input.push(text);
          if (accepted) emit("input", { text, ...(inputId ? { inputId } : {}) });
          return accepted;
        })
      : undefined;
    const conversation = sdk.query({
      prompt: input.stream,
      options: { ...base, ...(resume ? { resume } : {}) },
    });
    // The ring follows the answer: asked again after tool results, but not more often than this.
    let contextAt = 0;
    try {
      for await (const message of conversation) {
        mapper.handle(message);
        input.follow(message, mapper.working);
        if (message.type === "user" && Date.now() - contextAt > CONTEXT_REFRESH_MS) {
          contextAt = Date.now();
          void emitContext(conversation, emit);
        }
        if (message.type === "result") {
          await emitContext(conversation, emit);
          input.settled();
        } else if (message.type === "assistant" || message.type === "stream_event") input.busy();
      }
      mapper.finish();
    } finally {
      unregister?.();
      input.close();
      conversation.close();
    }
    // Where this answer ends in the transcript: the next message can branch off here.
    if (!mapper.failed && mapper.sessionId) {
      const tail = await chainTail(cwd, mapper.sessionId, sdk);
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
      ? await sessionAt(cwd, options.sessionId, options.tail, sdk)
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

/** The least time between two readings of how full the context is during one answer. */
const CONTEXT_REFRESH_MS = 4000;
const COMMANDS_TTL_MS = 60_000;
const commandCache = new Map<string, { at: number; commands: Promise<AgentCommand[]> }>();

/**
 * The slash commands (built in, user's, project's, plugins', skills') Claude Code offers in a
 * folder. They are only known to a running session, so one is started without a prompt, asked and
 * closed; the answer is kept for a minute.
 */
function claudeCommands(cwd: string, deps: ClaudeDeps): Promise<AgentCommand[]> {
  const cached = commandCache.get(cwd);
  if (cached && Date.now() - cached.at < COMMANDS_TTL_MS) return cached.commands;
  const commands = (async () => {
    const idle = (async function* (): AsyncGenerator<SDKUserMessage> {
      await new Promise<never>(() => {});
    })();
    const session = deps.sdk.query({
      prompt: idle,
      options: {
        cwd,
        env: claudeEnv(deps.api),
        settingSources: ["user", "project", "local"],
      },
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

/** Claude Code's permission policy: `default` asks in the chat before edits and shell commands. */
const PERMISSION_MODES = ["default", "plan", "acceptEdits", "auto", "bypassPermissions"] as const;

export function createClaudeBackend(api: PluginCodeApi): AgentBackend {
  const deps: ClaudeDeps = { api, sdk: api.require("@anthropic-ai/claude-agent-sdk") as ClaudeSdk };
  return {
    id: "claude-code",
    label: CLAUDE_LABEL,
    program: "claude",
    terminal: { program: "claude", executable: "claude", title: CLAUDE_LABEL },
    defaultFeatures: ["widgets"],
    capabilities: {
      hosted: true,
      inject: true,
      branchSession: true,
      compact: { command: "/compact", hintAt: 0.8, autoAt: 0.9 },
    },
    run: (options) => run(deps, options),
    controls: async () => CLAUDE_CONTROLS,
    commands: (cwd) => claudeCommands(cwd, deps),
    sessions: (cwd) => claudeSessions(cwd, deps),
    loadSession: (cwd, sessionId) => claudeLoadSession(cwd, sessionId, deps),
    updateSession: (cwd, sessionId, change) =>
      claudeUpdateSession(cwd, sessionId, change, deps.sdk),
    deleteSession: (cwd, sessionId) => claudeDeleteSession(cwd, sessionId, deps.sdk),
    rewindFiles: (cwd, sessionId, messageId, dryRun) =>
      rewindClaudeFiles(cwd, sessionId, messageId, dryRun, deps),
    mcpServers: (cwd) => claudeMcpServers(cwd, deps),
  };
}
