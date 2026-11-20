import type { ServerResponse } from "node:http";
import {
  createApprovalBridge,
  createCommandBridge,
  createQuestionBridge,
  createSecretBridge,
} from "./command-bridge.ts";
import {
  createRun,
  JOB_CHAT,
  pruneRuns,
  readRun,
  rememberSession,
  removeRun,
  schedulePrune,
  trackRun,
} from "./agent-runs.ts";
import { clearRecentRunForChat, setRecentRunResume } from "./recent-runs.ts";
import { trackEventStream } from "./event-streams.ts";
import { requestFrom } from "./request.ts";
import { failureFromError } from "./failure.ts";
import { collectRunResult } from "./run-result.ts";
import { abortChatResume } from "./chat-resume.ts";
import { isHostedAgent, runAgent } from "./registry.ts";
import { driveRun, isRunDriven, joinRun, type RunViewer } from "./run-hub.ts";
import { broadcastEvent, hasEventClient } from "../events/index.ts";
import { asString, json } from "../transport/index.ts";
import { resolveJudgeSettings } from "@ai-projector/core/modules/agent-judge/index.ts";
import { createJudgedApproval, readJudgeSettings } from "../judge/index.ts";

/**
 * Starts an answer, or rejoins one that a hosted process is still producing. A page that opens
 * the same chat watches the run this server already drives: attaching to the host again would
 * replace the socket of the page that got there first.
 */
export async function handleAgentRun({
  res,
  body,
}: {
  res: ServerResponse;
  body: Record<string, unknown>;
}): Promise<void> {
  // A page with its own events stream asks for the answer there: the request returns at once and
  // holds no connection (a browser allows few per origin for all its tabs). Others get an SSE body.
  const client = asString(body.client);
  const stream = asString(body.stream);
  const viaEvents = !!client && !!stream;
  if (viaEvents && !hasEventClient(client)) {
    json(res, 409, { error: "Поток событий страницы не открыт" });
    return;
  }
  const attachId = asString(body.attach);
  // A rejoined run repeats the request an earlier server stored; a new one reads it from the body.
  const stored = attachId ? await readRun(attachId) : null;
  if (attachId && !stored) {
    json(res, 404, { error: "Ход агента не найден" });
    return;
  }
  const created = stored ? undefined : await requestFrom(body);
  // What the client can show is stored with the run: a runner that outlives this request needs it.
  const request = stored ?? {
    ...created!.request,
    projectId: asString(body.projectId) || undefined,
    chat: asString(body.chat) || undefined,
    approvals: body.approvals === true,
    commandBridge: body.commandBridge === true,
  };
  const backend = request.backend;
  const hosted = isHostedAgent(backend);
  const startedAt = Date.now();
  const run = hosted
    ? { id: attachId || (await createRun(request)), attach: !!attachId }
    : undefined;
  if (hosted && !attachId) {
    void pruneRuns().catch(() => {});
    if (request.chat && !request.chat.startsWith(JOB_CHAT))
      void clearRecentRunForChat(request.chat).catch(() => {});
  }
  // A new message is a decision to continue now: a plan waiting for the reset is no longer needed.
  if (!attachId && request.chat && !request.chat.startsWith(JOB_CHAT)) {
    abortChatResume(request.chat);
    void setRecentRunResume(request.chat, null).catch(() => {});
  }

  if (viaEvents) {
    json(res, 202, { accepted: true, ...(run ? { run: run.id } : {}) });
  } else
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // The page keeps the id even if the stream breaks before its first event.
      ...(run ? { "X-Agent-Run": run.id } : {}),
    });
  // The newcomer gets the answer so far and then the live events, like the first page sees them.
  if (run && attachId && isRunDriven(attachId)) {
    let closed = false;
    let untrackStream: (() => void) | undefined;
    let release: (() => void) | undefined;
    const stop = () => {
      if (closed) return;
      closed = true;
      untrackStream?.();
      release?.();
    };
    const viewer: RunViewer = {
      key: viaEvents ? client : undefined,
      emit(event, data) {
        if (closed) return;
        if (viaEvents) broadcastEvent("agent", { stream, event, data }, client);
        else if (!res.writableEnded)
          res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      },
      close() {
        if (closed) return;
        closed = true;
        untrackStream?.();
        if (viaEvents) broadcastEvent("agent", { stream, event: "end", data: {} }, client);
        else if (!res.writableEnded) res.end();
        release?.();
      },
    };
    const leave = joinRun(attachId, viewer);
    if (leave) {
      const left = () => {
        leave();
        stop();
      };
      untrackStream = viaEvents ? trackEventStream(stream, client, left) : undefined;
      if (!viaEvents) {
        res.on("close", left);
        await new Promise<void>((resolve) => (release = resolve));
      }
      return;
    }
  }
  // A closed page only detaches from a hosted run, which keeps going and can be rejoined;
  // other agents stop with their request. Stopping a hosted run is the explicit cancel.
  const abort = new AbortController();
  let detached = false;
  let driver: ReturnType<typeof driveRun> | undefined;
  let untrackStream: (() => void) | undefined;
  const send = (event: string, data: unknown) => {
    if (viaEvents) broadcastEvent("agent", { stream, event, data }, client);
    else if (!res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  const viewer: RunViewer = {
    key: viaEvents ? client : undefined,
    emit(event, data) {
      if (!detached) send(event, data);
    },
    close() {
      untrackStream?.();
      if (viaEvents) broadcastEvent("agent", { stream, event: "end", data: {} }, client);
      else if (!res.writableEnded) res.end();
    },
  };
  driver = run ? driveRun(run.id, viewer) : undefined;
  const detach = () => {
    if (detached) return;
    detached = true;
    driver?.leave();
    if (!hosted) abort.abort();
  };
  untrackStream = viaEvents ? trackEventStream(stream, client, detach) : undefined;
  if (!viaEvents) res.on("close", detach);
  const untrack = run ? trackRun(run.id, () => abort.abort()) : undefined;
  const result = collectRunResult((session) => {
    // Also save sessions produced after the last page detached.
    if (run && !run.attach) void rememberSession(run.id, session).catch(() => {});
  });
  const emit = result.capture((event, data) => {
    if (driver) driver.publish(event, data);
    else if (!detached && (!viaEvents || !res.writableEnded)) send(event, data);
  });
  if (run) emit("run", { id: run.id });
  if (created?.worktree) emit("worktree", created.worktree);
  const approval = body.approvals === true ? createApprovalBridge(emit, abort.signal) : undefined;
  // ACP asks through this server even when its agent process is hosted; Projector and Claude Code
  // ask inside their own runner, where `hosted-runner.ts` wraps the same approval.
  const approve = approval
    ? createJudgedApproval({
        approve: approval,
        emit: (event, data) => emit(event, data),
        settings: resolveJudgeSettings(await readJudgeSettings(), request.judge),
        cwd: request.cwd,
        backend,
        signal: abort.signal,
      })
    : approval;
  try {
    await runAgent({
      ...request,
      backend,
      run,
      commands: body.commandBridge === true ? createCommandBridge(emit, abort.signal) : undefined,
      approve,
      ask: body.approvals === true ? createQuestionBridge(emit, abort.signal) : undefined,
      secret: body.approvals === true ? createSecretBridge(emit, abort.signal) : undefined,
      abort: abort.signal,
      emit,
    });
  } catch (error) {
    const info = failureFromError(error);
    emit("error", { error: info.message, failure: info });
  }
  driver?.finish();
  untrack?.();
  if (run && !request.chat?.startsWith(JOB_CHAT)) {
    const session = result.session ?? request.session ?? request.sessionId;
    await result.record(
      {
        id: run.id,
        backend,
        projectId: request.projectId ?? "",
        chat: request.chat ?? "",
        topic: request.message.trim().slice(0, 120),
        ...(session ? { session } : {}),
        ...(request.cwd ? { cwd: request.cwd } : {}),
        ...(request.selection ? { selection: request.selection } : {}),
        ...(request.permissionMode ? { permissionMode: request.permissionMode } : {}),
        startedAt: stored?.startedAt ?? startedAt,
      },
      abort.signal.aborted,
    );
  }
  // The answer reached a page, or the user cancelled it: nothing is left to rejoin.
  if (run) {
    const removed =
      ((driver?.delivered() ?? false) || abort.signal.aborted) &&
      (await removeRun(run.id).catch(() => false));
    if (!removed) schedulePrune();
  }
  if (!driver) {
    if (viaEvents) {
      untrackStream?.();
      if (!detached) broadcastEvent("agent", { stream, event: "end", data: {} }, client);
    } else if (!res.writableEnded) res.end();
  }
}
