import { query } from "@anthropic-ai/claude-agent-sdk";
import type { Options } from "@anthropic-ai/claude-agent-sdk";
import { agentEnv, assertHostProject, promptWithHistory } from "./agent-host.ts";
import type { AgentBackend, AgentRunOptions } from "./backend.ts";
import { CLAUDE_LABEL, createClaudeEventMapper } from "./claude-code-events.ts";

/**
 * Plain Claude Code behind a chat UI instead of the TUI: its own prompt, tools, login, `CLAUDE.md`
 * and settings. Nothing about Projector is added to the model's context.
 */
async function run(options: AgentRunOptions): Promise<void> {
  if (!options.cwd) throw new Error("Claude Code работает внутри проекта: откройте чат в проекте");
  await assertHostProject(options.cwd, CLAUDE_LABEL);

  const abortController = new AbortController();
  const forwardAbort = () => abortController.abort();
  if (options.abort?.aborted) abortController.abort();
  else options.abort?.addEventListener("abort", forwardAbort, { once: true });

  const mode = options.permissionMode ?? "default";
  const base: Options = {
    cwd: options.cwd,
    abortController,
    env: agentEnv(),
    includePartialMessages: true,
    settingSources: ["user", "project", "local"],
    systemPrompt: { type: "preset", preset: "claude_code" },
    permissionMode: mode,
    ...(mode === "bypassPermissions" ? { allowDangerouslySkipPermissions: true } : {}),
    canUseTool: async (toolName, input, context) => {
      if (!options.approve)
        return { behavior: "deny", message: "Клиент не может показать запрос разрешения" };
      const allowed = await options
        .approve({ tool: toolName, input, title: context.title ?? context.displayName })
        .catch(() => false);
      return allowed
        ? { behavior: "allow", updatedInput: input }
        : { behavior: "deny", message: "Пользователь отклонил действие" };
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
    const conversation = query({ prompt, options: { ...base, ...(resume ? { resume } : {}) } });
    try {
      for await (const message of conversation) mapper.handle(message);
    } finally {
      conversation.close();
    }
    // The session may be gone (project moved, transcript pruned): start over from the history.
    if (resume && mapper.failed && !mapper.started && !abortController.signal.aborted)
      return attempt(undefined);
    if (heldError) options.emit("error", heldError);
  };

  try {
    options.emit("status", { phase: "thinking", provider: CLAUDE_LABEL, model: "" });
    await attempt(options.sessionId);
  } finally {
    options.abort?.removeEventListener("abort", forwardAbort);
  }
}

export const claudeCodeBackend: AgentBackend = { id: "claude-code", run };
