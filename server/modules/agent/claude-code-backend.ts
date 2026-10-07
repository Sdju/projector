import { query } from "@anthropic-ai/claude-agent-sdk";
import type { Options } from "@anthropic-ai/claude-agent-sdk";
import { devcontainerForPath } from "../devcontainer/index.ts";
import { environmentForPath } from "../environments/index.ts";
import type { AgentHistoryTurn } from "../providers/index.ts";
import type { AgentBackend, AgentRunOptions } from "./backend.ts";
import { CLAUDE_LABEL, createClaudeEventMapper } from "./claude-code-events.ts";

/** Env names that must not leak from Projector's server into a coding agent's shell. */
const PRIVATE_ENV = [
  "PROVIDERS_SECRET",
  "OPENAI_API_KEY",
  "DASHSCOPE_API_KEY",
  "QWENCLOUD_API_KEY",
];

function agentEnv(): Record<string, string | undefined> {
  const env = { ...process.env };
  for (const name of PRIVATE_ENV) delete env[name];
  return env;
}

/** Without a native session the earlier chat is replayed as text. */
function promptWithHistory(message: string, history: AgentHistoryTurn[]): string {
  if (!history.length) return message;
  const transcript = history
    .slice(-10)
    .map((turn) => `${turn.role === "user" ? "Пользователь" : "Ассистент"}: ${turn.content}`)
    .join("\n\n");
  return `Предыдущая переписка в этом чате:\n\n${transcript}\n\nНовое сообщение пользователя:\n${message}`;
}

/** Claude Code's own tools run on the host, so projects with an isolating environment are refused. */
async function assertHostProject(cwd: string): Promise<void> {
  if ((await devcontainerForPath(cwd)) || (await environmentForPath(cwd)))
    throw new Error(
      "Claude Code выполняет инструменты на машине пользователя и недоступен в проектах с Docker-окружением или Dev Container. Откройте терминальную сессию.",
    );
}

/**
 * Plain Claude Code behind a chat UI instead of the TUI: its own prompt, tools, login, `CLAUDE.md`
 * and settings. Nothing about Projector is added to the model's context.
 */
async function run(options: AgentRunOptions): Promise<void> {
  if (!options.cwd) throw new Error("Claude Code работает внутри проекта: откройте чат в проекте");
  await assertHostProject(options.cwd);

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
