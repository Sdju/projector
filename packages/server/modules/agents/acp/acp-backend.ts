import { acpProgram, type AcpProgram, registerAcpProgram } from "./acp-programs.ts";
import { acpLaunchAvailable, acpTerminalExecutable } from "./acp-launch.ts";
import {
  attachedImages,
  failureFromAcp,
  promptWithHistory,
  waitRunExit,
} from "../../agent/index.ts";
import { featureEnabled, featurePrompt } from "../../agent-features/index.ts";
import { acpIdeMcpServer } from "../ide-mcp/index.ts";
import { roleContext } from "../../agent-roles/index.ts";
import { trustedProjectWidgets } from "../../project-widgets/index.ts";
import { renderWidgetGuide } from "@ai-projector/core/modules/widget-catalog/index.ts";
import type { AgentBackend, AgentBackendId, AgentRunOptions } from "../../agent/index.ts";
import {
  configuredMcpServers,
  sessionMcpServers,
  userMcpServers,
  type AcpMcpServer,
  type McpSupport,
} from "./mcp-config.ts";
export { sessionMcpServers } from "./mcp-config.ts";
import { elicitForm } from "./acp-elicitation.ts";
import { type AcpConnection, type AcpError, NO_TIMEOUT } from "./acp-client.ts";
import { applySelection, controlsFromSession, shownModel } from "./acp-controls.ts";
import { isCompactCommand } from "./acp-dialect.ts";
import { createAcpEventMapper, stopReasonError } from "./acp-events.ts";
import { settleAcpAnswer } from "./acp-follow-up.ts";
import { acpAdvertisedDelete, initializeAcp, startAcp } from "./acp-process.ts";
import {
  acpCommands,
  acpControls,
  acpDeleteSession,
  acpLoadSession,
  acpSessions,
} from "./acp-tools.ts";
import { promptBlocks } from "./acp-prompt.ts";
import { reserveAcpSession } from "./acp-session-owner.ts";

import { decidePermission } from "./acp-permission.ts";
export { decidePermission, toolCallDetail } from "./acp-permission.ts";
/** An external agent driven through its ACP server over stdio. */
export function createAcpBackend(program: AcpProgram): AgentBackend {
  registerAcpProgram(program);
  const id = program.id;
  const terminalDefaults = {
    program: id,
    executable: id,
    title: program.label,
    ...program.terminal,
  };
  // The executable follows a machine-local override without re-registering the backend.
  const terminal = {
    program: terminalDefaults.program,
    title: terminalDefaults.title,
    get executable() {
      return acpTerminalExecutable(id, terminalDefaults.executable);
    },
  };
  return {
    id,
    label: program.label,
    program: terminal.program,
    terminal,
    launch: true,
    capabilities: {
      hosted: true,
      get deleteSessions() {
        return acpAdvertisedDelete(id);
      },
    },
    run: (options) => run(options, id),
    available: () => acpLaunchAvailable(id),
    controls: (cwd) => acpControls(id, cwd),
    commands: (cwd) => acpCommands(id, cwd),
    sessions: (cwd) => acpSessions(id, cwd),
    loadSession: (cwd, sessionId) => acpLoadSession(id, cwd, sessionId),
    deleteSession: (cwd, sessionId) => acpDeleteSession(id, cwd, sessionId),
    mcpServers: configuredMcpServers,
  };
}

async function run(options: AgentRunOptions, id: AgentBackendId): Promise<void> {
  const program = acpProgram(id);
  const compactCommand = isCompactCommand(options.message, options.parts);
  let sessionId = "";
  const mapper = createAcpEventMapper(options.emit, program.label, program.dialect?.(), {
    compactCommand,
    sessionId: () => sessionId,
  });
  let followUp: ReturnType<NonNullable<typeof program.prepareFollowUp>> | undefined;
  let settling = false;
  // `session/load` replays the whole conversation; those updates are history, not this answer.
  let replaying = false;
  let connection: AcpConnection | undefined;
  const abort = () => {
    if (connection && sessionId) connection.notify("session/cancel", { sessionId });
    void connection?.close();
  };
  const connect = () =>
    startAcp(
      id,
      options.cwd,
      {
        onNotification(method, params) {
          if (replaying) return;
          if (method === "session/update") {
            const update = (params.update ?? {}) as Record<string, unknown>;
            const sourceSession = typeof params.sessionId === "string" ? params.sessionId : "";
            if (settling && followUp && !followUp.acceptsUpdates(sourceSession, update)) return;
            mapper.handleUpdate(sourceSession, update);
            return;
          }
          acpProgram(id).notifications?.[method]?.(options, params);
        },
        onRequest(method, params) {
          const extension = acpProgram(id).extensions?.[method];
          if (extension) return extension(options, params);
          if (method === "elicitation/create")
            return elicitForm(options, params, acpProgram(id).forms);
          if (method !== "session/request_permission")
            throw new Error(`Клиент не поддерживает ${method}`);
          return decidePermission(options, params, acpProgram(id).shellCommand);
        },
      },
      options.run,
    );
  const release = await reserveAcpSession(id, options.sessionId, options.run?.id);
  let releaseNew: (() => void) | undefined;
  let keepProcess = false;
  try {
    options.abort?.throwIfAborted();
    connection = await connect();
    options.abort?.addEventListener("abort", abort, { once: true });
    if (options.abort?.aborted) abort();
    options.emit("status", { phase: "thinking", provider: program.label, model: "" });
    const init = await initializeAcp(connection, id);
    const [ideEnabled, widgetsEnabled, roleText] = await Promise.all([
      featureEnabled(id, "ide", options.features),
      featureEnabled(id, "widgets", options.features),
      roleContext(options.role, options.cwd),
    ]);
    const projectWidgets = widgetsEnabled ? await trustedProjectWidgets(options.projectId) : [];
    const extraPrompt = [roleText, projectWidgets.length ? renderWidgetGuide(projectWidgets) : ""]
      .filter(Boolean)
      .join("\n\n");
    const extraMcp = [
      ...(options.projectId && ideEnabled ? [acpIdeMcpServer(options.projectId)] : []),
      ...(options.role?.mcp
        ? await userMcpServers(
            options.cwd,
            options.role.mcp,
            init.agentCapabilities?.mcpCapabilities,
          )
        : []),
    ];
    const session = await openSession(
      connection,
      options,
      init.authMethods ?? [],
      (active) => {
        replaying = active;
      },
      init.agentCapabilities?.loadSession === true,
      init.agentCapabilities?.mcpCapabilities,
      extraMcp,
      options.role?.mcp,
    );
    sessionId = session.sessionId;
    if (sessionId !== options.sessionId)
      releaseNew = await reserveAcpSession(id, sessionId, options.run?.id);
    options.emit("session", { id: sessionId, backend: id });
    // What the agent offers for this session, with the user's choices applied before the prompt.
    const offered = controlsFromSession(session.result);
    if (offered.length) {
      const chosen =
        program.normalizeSelection?.(options.selection ?? {}, offered) ?? options.selection ?? {};
      const applied = await applySelection(connection, sessionId, offered, chosen);
      mapper.setModel(shownModel(applied));
      options.emit("controls", { controls: applied });
      options.emit("status", {
        phase: "thinking",
        provider: program.label,
        model: shownModel(applied),
      });
    }
    // A resumed session already holds the history; a fresh one starts from the replayed chat.
    // Abilities the user switched on for this agent go before the new message, once per session.
    const prompt = session.resumed
      ? options.message
      : promptWithHistory(
          options.message,
          options.history ?? [],
          await featurePrompt(id, options.features, extraPrompt),
        );
    followUp = program.prepareFollowUp?.(sessionId);
    const result = (await connection.request(
      "session/prompt",
      {
        sessionId,
        prompt: promptBlocks(
          prompt,
          options.parts,
          options.cwd,
          init.agentCapabilities?.promptCapabilities?.image === true
            ? await attachedImages(options.parts)
            : [],
        ),
      },
      NO_TIMEOUT,
    )) as { stopReason?: unknown };
    if (options.abort?.aborted) return;
    const stopReason = result?.stopReason;
    if (stopReason === "end_turn" || stopReason === "cancelled") {
      // The last child reports as OpenCode wakes the parent: keep the stream and the process.
      settling = true;
      // Preserve the process even if observation itself throws.
      keepProcess = mapper.hadBackground && !!followUp;
      keepProcess = await settleAcpAnswer({
        answer: mapper,
        program,
        followUp,
        disconnected: connection.disconnected,
        incomingActivity: connection.incomingActivity,
        options,
      });
    } else {
      options.emit("error", {
        error: stopReasonError(stopReason),
        failure: failureFromAcp(undefined, stopReason),
      });
    }
  } catch (error) {
    if (!options.abort?.aborted) {
      const failure = failureFromAcp(error);
      options.emit("error", { error: failure.message, failure });
    }
  } finally {
    options.abort?.removeEventListener("abort", abort);
    if (program.finishAfterBackground && mapper.pendingBackground)
      mapper.stopBackground("Ход прерван до получения итога фоновой задачи");
    try {
      const stop = !keepProcess || !!options.abort?.aborted;
      await connection?.close({ stop });
      if (stop && connection && program.exclusiveSession && options.run)
        await waitRunExit(options.run.id);
    } finally {
      releaseNew?.();
      release();
    }
  }
}

/**
 * Resume the native session when the agent supports it, otherwise start a fresh one. The ACP
 * `session/load` response has no `sessionId`, so the requested one is kept; an agent without
 * `loadSession`, or a load that finds no such session, falls back to `session/new` with the
 * replayed history. Any other load error is reported as is. If the agent refuses until
 * authenticated, the first advertised method is used once.
 */
export async function openSession(
  connection: AcpConnection,
  options: AgentRunOptions,
  authMethods: { id?: string }[],
  replay: (active: boolean) => void,
  canLoad = true,
  mcp: McpSupport = {},
  extraMcp: AcpMcpServer[] = [],
  roleMcp?: readonly string[],
): Promise<{ sessionId: string; resumed: boolean; result: unknown }> {
  const servers = () => sessionMcpServers(options.cwd, mcp, extraMcp, roleMcp);
  const start = async () => {
    if (options.sessionId && canLoad) {
      replay(true);
      try {
        const loaded = await connection.request("session/load", {
          sessionId: options.sessionId,
          cwd: options.cwd,
          mcpServers: await servers(),
        });
        return { sessionId: options.sessionId, resumed: true, result: loaded };
      } catch (error) {
        // A dead connection or a missing login must surface as is; only a session that is gone
        // (moved project, pruned transcript) falls back to a fresh one.
        if ((error as AcpError).fatal || isAuthError(error) || !isMissingSession(error))
          throw error;
      } finally {
        replay(false);
      }
    }
    const created = (await connection.request("session/new", {
      cwd: options.cwd,
      mcpServers: await servers(),
    })) as { sessionId: string };
    return { sessionId: created.sessionId, resumed: false, result: created };
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

/** The requested native session is gone; a fresh one is the only way to continue. */
function isMissingSession(error: unknown): boolean {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  return /no such session|unknown session|session .*not found|failed to load session/i.test(
    message,
  );
}

/** The agent refuses a session until the CLI is authenticated. */
function isAuthError(error: unknown): boolean {
  const code = (error as { code?: number } | null)?.code;
  if (code === 401) return true;
  const message = error instanceof Error ? error.message : "";
  return /authenticat|auth required|not logged|login|log in|авториз/i.test(message);
}
