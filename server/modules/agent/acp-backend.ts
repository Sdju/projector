import { os } from "../../../core/modules/os/index.ts";
import {
  createAcpConnection,
  NO_TIMEOUT,
  type AcpConnection,
  type AcpError,
} from "./acp-client.ts";
import { contentText, createAcpEventMapper } from "./acp-events.ts";
import { ACP_PROGRAMS, type AcpProgram } from "./acp-programs.ts";
import { agentEnv, assertHostProject, promptWithHistory } from "./agent-host.ts";
import type { AgentBackend, AgentBackendId, AgentRunOptions } from "./backend.ts";

/** Agent Client Protocol revision this client speaks. */
const PROTOCOL_VERSION = 1;

interface PermissionOption {
  optionId?: string;
  kind?: string;
}

function stopReasonError(stopReason: unknown): string {
  if (stopReason === "max_tokens") return "Достигнут лимит ответа агента";
  if (stopReason === "max_turn_requests") return "Достигнут лимит шагов агента";
  if (stopReason === "refusal") return "Агент отказался выполнять запрос";
  return "Агент завершился с ошибкой";
}

/** An external agent driven through its ACP server over stdio. */
export function createAcpBackend(id: AgentBackendId): AgentBackend {
  return { id, run: (options) => run(options, id) };
}

/**
 * Prefer a globally installed binary. `npx` reads the working directory's `package.json`, so a
 * project that pins another package manager (`devEngines`/`packageManager`) makes npm refuse to
 * start; the `npx` fallback therefore runs outside the project. The session still gets the project
 * through `session/new`, so the agent's own config and files are unaffected.
 */
async function resolveLaunch(program: AcpProgram, cwd: string) {
  // Resolve programs the way a terminal session does, not through the server's own PATH.
  const env = await os.tools.agentEnv(agentEnv());
  if (program.binary && os.tools.commandExists(program.binary, env))
    return { command: program.binary, args: [] as string[], cwd, env };
  if (program.command === "npx")
    return { command: program.command, args: program.args, cwd: os.dataHome(), env };
  return { command: program.command, args: program.args, cwd, env };
}

async function run(options: AgentRunOptions, id: AgentBackendId): Promise<void> {
  const program = ACP_PROGRAMS[id];
  if (!program) throw new Error(`Неизвестный ACP-агент: ${id}`);
  if (!options.cwd)
    throw new Error(`${program.label} работает внутри проекта: откройте чат в проекте`);
  await assertHostProject(options.cwd, program.label);

  const child = os.tools.spawnAgentProcess(await resolveLaunch(program, options.cwd));
  const mapper = createAcpEventMapper(options.emit, program.label);
  let sessionId = "";
  // `session/load` replays the whole conversation; those updates are history, not this answer.
  let replaying = false;
  let connection: AcpConnection;
  const abort = () => {
    if (sessionId) connection.notify("session/cancel", { sessionId });
    void connection.close();
  };
  connection = createAcpConnection(child, {
    label: program.label,
    onNotification(method, params) {
      if (method !== "session/update" || replaying) return;
      mapper.handleUpdate(
        String(params.sessionId ?? ""),
        (params.update ?? {}) as Record<string, unknown>,
      );
    },
    onRequest(method, params) {
      if (method !== "session/request_permission")
        throw new Error(`Клиент не поддерживает ${method}`);
      return decidePermission(options, params);
    },
  });
  options.abort?.addEventListener("abort", abort, { once: true });
  if (options.abort?.aborted) abort();

  options.emit("status", { phase: "thinking", provider: program.label, model: "" });
  try {
    const init = (await connection.request("initialize", {
      protocolVersion: PROTOCOL_VERSION,
      clientCapabilities: {
        fs: { readTextFile: false, writeTextFile: false },
        terminal: false,
      },
      clientInfo: { name: "projector", title: "Projector", version: "1.0" },
    })) as { authMethods?: { id?: string }[]; agentCapabilities?: { loadSession?: boolean } };
    const session = await openSession(
      connection,
      options,
      init.authMethods ?? [],
      (active) => {
        replaying = active;
      },
      init.agentCapabilities?.loadSession === true,
    );
    sessionId = session.sessionId;
    options.emit("session", { id: sessionId, backend: id });
    // A resumed session already holds the history; a fresh one starts from the replayed chat.
    const prompt = session.resumed
      ? options.message
      : promptWithHistory(options.message, options.history ?? []);
    const result = (await connection.request(
      "session/prompt",
      { sessionId, prompt: [{ type: "text", text: prompt }] },
      NO_TIMEOUT,
    )) as { stopReason?: unknown };
    if (options.abort?.aborted) return;
    const stopReason = result?.stopReason;
    if (stopReason === "end_turn" || stopReason === "cancelled")
      options.emit("done", { text: mapper.text.trim(), added: [] });
    else options.emit("error", { error: stopReasonError(stopReason) });
  } catch (error) {
    if (!options.abort?.aborted)
      options.emit("error", {
        error: error instanceof Error ? error.message : "Агент недоступен",
      });
  } finally {
    options.abort?.removeEventListener("abort", abort);
    await connection.close();
  }
}

/**
 * Resume the native session when the agent supports it, otherwise start a fresh one. The ACP
 * `session/load` response has no `sessionId`, so the requested one is kept; an agent without the
 * `loadSession` capability, or a load that finds no such session, falls back to `session/new` with the replayed
 * history. If the agent refuses until authenticated, the first advertised method is used once.
 */
export async function openSession(
  connection: AcpConnection,
  options: AgentRunOptions,
  authMethods: { id?: string }[],
  replay: (active: boolean) => void,
  canLoad = true,
): Promise<{ sessionId: string; resumed: boolean }> {
  const start = async () => {
    if (options.sessionId && canLoad) {
      replay(true);
      try {
        await connection.request("session/load", {
          sessionId: options.sessionId,
          cwd: options.cwd,
          mcpServers: [],
        });
        return { sessionId: options.sessionId, resumed: true };
      } catch (error) {
        // A dead connection or a missing login must surface as is; only a session that is gone
        // (moved project, pruned transcript) falls back to a fresh one.
        if ((error as AcpError).fatal || isAuthError(error)) throw error;
      } finally {
        replay(false);
      }
    }
    const created = (await connection.request("session/new", {
      cwd: options.cwd,
      mcpServers: [],
    })) as { sessionId: string };
    return { sessionId: created.sessionId, resumed: false };
  };
  try {
    return await start();
  } catch (error) {
    const methodId = authMethods.find((method) => method.id)?.id;
    if (!methodId || !isAuthError(error)) throw error;
    await connection.request("authenticate", { methodId });
    return await start();
  }
}

/** The agent refuses a session until the CLI is authenticated (Cursor, Codex). */
function isAuthError(error: unknown): boolean {
  const code = (error as { code?: number } | null)?.code;
  if (code === 401) return true;
  const message = error instanceof Error ? error.message : "";
  return /authenticat|auth required|not logged|login|log in|авториз/i.test(message);
}

/** Longest readable preview sent with a permission request. */
const DETAIL_LIMIT = 8000;

/**
 * A readable preview of what the tool will change. ACP carries edits and MCP arguments in
 * `toolCall.content` (`diff`/`content` blocks), which the raw input does not show.
 */
export function toolCallDetail(toolCall: Record<string, unknown>): string | undefined {
  const content = Array.isArray(toolCall.content) ? toolCall.content : [];
  const parts = content
    .map((item) => {
      const block = item as {
        type?: string;
        content?: unknown;
        path?: string;
        oldText?: string | null;
        newText?: string | null;
      };
      if (block.type === "diff") return diffText(block);
      if (block.type === "content") return contentText(block.content);
      return "";
    })
    .filter(Boolean);
  if (!parts.length) return undefined;
  return parts.join("\n\n").slice(0, DETAIL_LIMIT);
}

function diffText(block: {
  path?: string;
  oldText?: string | null;
  newText?: string | null;
}): string {
  const path = block.path ?? "файл";
  const removed = String(block.oldText ?? "")
    .split("\n")
    .map((line) => `-${line}`);
  const added = String(block.newText ?? "")
    .split("\n")
    .map((line) => `+${line}`);
  return [`--- ${path}`, `+++ ${path}`, ...removed, ...added].join("\n");
}

/**
 * Maps the ACP permission options onto the chat's prompt. A one-time allow/reject is always
 * preferred: `allow_always` is used only when the user chose "always" (or no one-time option
 * exists), so a plain "Разрешить" never silently widens the agent's rights.
 */
export async function decidePermission(
  options: AgentRunOptions,
  params: Record<string, unknown>,
): Promise<unknown> {
  const toolCall = (params.toolCall ?? {}) as Record<string, unknown>;
  const list = Array.isArray(params.options) ? (params.options as PermissionOption[]) : [];
  const allowOnce = list.find((item) => item.kind === "allow_once");
  const allowAlways = list.find((item) => item.kind === "allow_always");
  const allow = allowOnce ?? allowAlways;
  if (!options.approve || !allow) return { outcome: { outcome: "cancelled" } };
  const tool = String(toolCall.title || toolCall.kind || "tool");
  const answer = await options
    .approve({
      tool,
      input: toolCall.rawInput ?? {},
      title: typeof toolCall.title === "string" ? toolCall.title : undefined,
      detail: toolCallDetail(toolCall),
      persistent: !!allowAlways,
    })
    .catch(() => false);
  if (answer === false) {
    const reject =
      list.find((item) => item.kind === "reject_once") ??
      list.find((item) => item.kind === "reject_always");
    if (!reject?.optionId) return { outcome: { outcome: "cancelled" } };
    return { outcome: { outcome: "selected", optionId: reject.optionId } };
  }
  const chosen = answer === "always" ? (allowAlways ?? allowOnce) : (allowOnce ?? allowAlways);
  if (!chosen?.optionId) return { outcome: { outcome: "cancelled" } };
  return { outcome: { outcome: "selected", optionId: chosen.optionId } };
}
