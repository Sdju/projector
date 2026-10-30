import {
  GUI_AGENT_PROGRAMS,
  preferences,
  setAgentDefault,
  setAgentEnabled,
  setAgentMode,
} from "../../modules/preferences/index.ts";
import { loadProjects } from "../../modules/projects/index.ts";
import {
  agentCommands,
  agentControls,
  agentCapabilities,
  agentMcpServers,
  agentSessions,
  rewindAgentFiles,
  updateAgentSession,
  deleteAgentSession,
  loadAgentSession,
  runAgent,
  createCommandBridge,
  createApprovalBridge,
  createQuestionBridge,
  createSecretBridge,
  completeCommandRequest,
  cancelRun,
  createRun,
  listLiveRuns,
  pruneRuns,
  readRun,
  rememberSession,
  removeRun,
  schedulePrune,
  trackRun,
  isHostedAgent,
  injectMessage,
  worktreeCwd,
  readAgentHistory,
  readChatFeatures,
  readAttachment,
  saveAttachment,
  writeAgentHistory,
  trackEventStream,
  requestFrom,
  detachEventStream,
} from "../../modules/agent/index.ts";

import { broadcastEvent, hasEventClient } from "../../modules/events/index.ts";
import { accessAllowed } from "../../modules/access/index.ts";
import { HttpError } from "../../modules/http/index.ts";
import { readBody, asString, json } from "../../modules/transport/index.ts";

import type { RouteContext } from "../../modules/transport/index.ts";

async function projectPath(projectId: string): Promise<string> {
  const project = (await loadProjects()).find((item) => item.id === projectId);
  if (!project) throw new Error("Проект не найден");
  return project.path;
}

/** The folder a chat's agent works in: the project, or the isolated copy the chat was given. */
async function agentFolder(projectId: string, worktree: string): Promise<string> {
  const path = await projectPath(projectId);
  return worktree ? worktreeCwd(projectId, worktree, path) : path;
}

export async function handleAgent({ req, res, url, method, path }: RouteContext): Promise<boolean> {
  const historyMatch = path.match(/^\/api\/agent\/history\/([^/]+)$/);
  if (historyMatch && (method === "GET" || method === "PUT")) {
    const id = decodeURIComponent(historyMatch[1]!);
    let turns;
    if (method === "GET") turns = await readAgentHistory(id);
    else {
      const body = await readBody(req);
      const project = asString(body.projectId);
      const backend = asString(body.backend);
      const title = asString(body.title);
      turns = await writeAgentHistory(
        id,
        body.turns,
        project && backend ? { project, backend, ...(title ? { title } : {}) } : undefined,
        body.features,
      );
    }
    json(res, 200, { turns, features: readChatFeatures(id) ?? null });
    return true;
  }
  if (path === "/api/agent/modes" && method === "GET") {
    const prefs = await preferences();
    json(res, 200, {
      modes: prefs.agentModes,
      programs: GUI_AGENT_PROGRAMS,
      disabled: prefs.disabledAgents,
    });
    return true;
  }
  if (path === "/api/agent/modes" && method === "PUT") {
    const body = await readBody(req);
    if (body.mode !== "tui" && body.mode !== "gui") throw new Error("Неизвестный режим сессии");
    await setAgentMode(asString(body.program), body.mode);
    const prefs = await preferences();
    json(res, 200, {
      modes: prefs.agentModes,
      programs: GUI_AGENT_PROGRAMS,
      disabled: prefs.disabledAgents,
    });
    return true;
  }
  if (path === "/api/agent/integrations" && method === "PUT") {
    const body = await readBody(req);
    if (typeof body.enabled !== "boolean") throw new Error("Укажите, включён ли агент");
    await setAgentEnabled(asString(body.backend), body.enabled);
    json(res, 200, { disabled: (await preferences()).disabledAgents });
    return true;
  }
  if (path === "/api/agent/attachments" && method === "POST") {
    if (!accessAllowed(req, true))
      throw new HttpError(403, "Загрузка доступна только со страницы Projector");
    const type = (req.headers["content-type"] ?? "").split(";")[0]!.trim();
    json(res, 201, await saveAttachment(req, type, url.searchParams.get("name") ?? ""));
    return true;
  }
  const attachment = path.match(/^\/api\/agent\/attachments\/([0-9a-f]+)$/);
  if (attachment && method === "GET") {
    const image = await readAttachment(attachment[1]!);
    if (!image) throw new HttpError(404, "Изображение не найдено");
    res.setHeader("Content-Type", image.mime);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
    res.setHeader("Content-Security-Policy", "sandbox; default-src 'none'");
    res.end(image.content);
    return true;
  }
  if (path === "/api/agent/defaults" && method === "GET") {
    json(res, 200, { defaults: (await preferences()).agentDefaults });
    return true;
  }
  if (path === "/api/agent/defaults" && method === "PUT") {
    const body = await readBody(req);
    await setAgentDefault(asString(body.backend), asString(body.id), asString(body.value));
    json(res, 200, { defaults: (await preferences()).agentDefaults });
    return true;
  }
  if (path === "/api/agent/controls" && method === "GET") {
    const projectId = url.searchParams.get("projectId") ?? "";
    // The Projector agent also works outside any project, on the catalog.
    const cwd = projectId ? await projectPath(projectId) : "";
    const backend = url.searchParams.get("backend") ?? undefined;
    json(res, 200, {
      controls: await agentControls(backend, cwd),
      capabilities: agentCapabilities(backend),
    });
    return true;
  }
  if (path === "/api/agent/commands" && method === "GET") {
    const projectId = url.searchParams.get("projectId") ?? "";
    const cwd = projectId ? await projectPath(projectId) : "";
    const backend = url.searchParams.get("backend") ?? undefined;
    json(res, 200, { commands: await agentCommands(backend, cwd) });
    return true;
  }
  if (path === "/api/agent/mcp" && method === "GET") {
    const cwd = await projectPath(url.searchParams.get("projectId") ?? "");
    const backend = url.searchParams.get("backend") ?? undefined;
    json(res, 200, { servers: await agentMcpServers(backend, cwd) });
    return true;
  }
  if (path === "/api/agent/rewind-files" && method === "POST") {
    if (!accessAllowed(req, true))
      throw new HttpError(403, "Откат доступен только со страницы Projector");
    const body = await readBody(req);
    const cwd = await agentFolder(asString(body.projectId), asString(body.worktree));
    const backend = asString(body.backend) || undefined;
    json(
      res,
      200,
      await rewindAgentFiles(
        backend,
        cwd,
        asString(body.sessionId),
        asString(body.messageId),
        body.dryRun === true,
      ),
    );
    return true;
  }
  if (path === "/api/agent/sessions" && method === "GET") {
    const cwd = await projectPath(url.searchParams.get("projectId") ?? "");
    const backend = url.searchParams.get("backend") ?? undefined;
    json(res, 200, { sessions: await agentSessions(backend, cwd) });
    return true;
  }
  if (path === "/api/agent/sessions/update" && method === "POST") {
    if (!accessAllowed(req, true))
      throw new HttpError(403, "Изменение доступно только со страницы Projector");
    const body = await readBody(req);
    const cwd = await projectPath(asString(body.projectId));
    const sessionId = asString(body.sessionId);
    if (!sessionId) throw new Error("Укажите сессию");
    await updateAgentSession(asString(body.backend) || undefined, cwd, sessionId, {
      ...(typeof body.title === "string" ? { title: body.title } : {}),
      ...(typeof body.pinned === "boolean" ? { pinned: body.pinned } : {}),
    });
    json(res, 200, { ok: true });
    return true;
  }
  if (path === "/api/agent/sessions/delete" && method === "POST") {
    if (!accessAllowed(req, true))
      throw new HttpError(403, "Удаление доступно только со страницы Projector");
    const body = await readBody(req);
    const cwd = await projectPath(asString(body.projectId));
    const sessionId = asString(body.sessionId);
    if (!sessionId) throw new Error("Укажите сессию");
    await deleteAgentSession(asString(body.backend) || undefined, cwd, sessionId);
    json(res, 200, { ok: true });
    return true;
  }
  if (path === "/api/agent/sessions/load" && method === "POST") {
    const body = await readBody(req);
    const cwd = await projectPath(asString(body.projectId));
    const sessionId = asString(body.sessionId);
    if (!sessionId) throw new Error("Укажите сессию");
    json(res, 200, { turns: await loadAgentSession(asString(body.backend), cwd, sessionId) });
    return true;
  }
  if (path === "/api/agent/tool-result" && method === "POST") {
    const body = await readBody(req);
    const accepted = completeCommandRequest(asString(body.id), {
      output: body.output,
      error: asString(body.error) || undefined,
    });
    json(res, accepted ? 200 : 410, { accepted });
    return true;
  }
  if (path === "/api/agent/inject" && method === "POST") {
    if (!accessAllowed(req, true))
      throw new HttpError(403, "Доступно только со страницы Projector");
    const body = await readBody(req);
    const text = asString(body.text).trim();
    if (!text) throw new Error("Напишите сообщение агенту");
    const accepted = await injectMessage(
      asString(body.messageId),
      text,
      asString(body.inputId) || undefined,
    );
    json(res, accepted ? 200 : 410, { accepted });
    return true;
  }
  if (path === "/api/agent/runs" && method === "GET") {
    json(res, 200, { runs: await listLiveRuns() });
    return true;
  }
  if (path === "/api/agent/cancel" && method === "POST") {
    const body = await readBody(req);
    await cancelRun(asString(body.runId));
    json(res, 200, { ok: true });
    return true;
  }
  if (path === "/api/agent/detach" && method === "POST") {
    const body = await readBody(req);
    detachEventStream(asString(body.stream));
    json(res, 200, { ok: true });
    return true;
  }
  if (path === "/api/agent" && method === "POST") {
    const body = await readBody(req);
    const attachId = asString(body.attach);
    // A rejoined run repeats the request an earlier server stored; a new one reads it from the body.
    const stored = attachId ? await readRun(attachId) : null;
    if (attachId && !stored) {
      json(res, 404, { error: "Ход агента не найден" });
      return true;
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
    const run = hosted
      ? { id: attachId || (await createRun(request)), attach: !!attachId }
      : undefined;
    if (hosted && !attachId) void pruneRuns().catch(() => {});

    // A page with its own events stream asks for the answer there: the request returns at once and
    // holds no connection (a browser allows few per origin for all its tabs). Others get an SSE body.
    const client = asString(body.client);
    const stream = asString(body.stream);
    const viaEvents = !!client && !!stream;
    if (viaEvents) {
      if (!hasEventClient(client)) {
        json(res, 409, { error: "Поток событий страницы не открыт" });
        return true;
      }
      json(res, 202, { accepted: true });
    } else
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      });
    // A closed page only detaches from a hosted run, which keeps going and can be rejoined;
    // other agents stop with their request. Stopping a hosted run is the explicit cancel.
    const abort = new AbortController();
    let detached = false;
    const detach = () => {
      if (detached) return;
      detached = true;
      if (!hosted) abort.abort();
    };
    const untrackStream = viaEvents ? trackEventStream(stream, client, detach) : undefined;
    if (!viaEvents) res.on("close", detach);
    const untrack = run ? trackRun(run.id, () => abort.abort()) : undefined;
    let delivered = false;
    const emit = (event: string, data: unknown) => {
      // Noted even after the page left: the run goes on, and its session is how it is found again.
      if (event === "session" && run && !run.attach)
        void rememberSession(run.id, (data as { id: string }).id).catch(() => {});
      if (detached || (!viaEvents && res.writableEnded)) return;
      if (event === "done" || event === "error") delivered = true;
      if (viaEvents) broadcastEvent("agent", { stream, event, data }, client);
      else res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    if (run) emit("run", { id: run.id });
    if (created?.worktree) emit("worktree", created.worktree);
    try {
      await runAgent({
        ...request,
        backend,
        run,
        commands: body.commandBridge === true ? createCommandBridge(emit, abort.signal) : undefined,
        approve: body.approvals === true ? createApprovalBridge(emit, abort.signal) : undefined,
        ask: body.approvals === true ? createQuestionBridge(emit, abort.signal) : undefined,
        secret: body.approvals === true ? createSecretBridge(emit, abort.signal) : undefined,
        abort: abort.signal,
        emit,
      });
    } catch (error) {
      const text = error instanceof Error ? error.message : "Ошибка агента";
      emit("error", { error: text });
    }
    untrack?.();
    // The answer reached the page, or the user cancelled it: nothing is left to rejoin.
    if (run) {
      const removed =
        (delivered || abort.signal.aborted) && (await removeRun(run.id).catch(() => false));
      if (!removed) schedulePrune();
    }
    if (viaEvents) {
      untrackStream?.();
      if (!detached) broadcastEvent("agent", { stream, event: "end", data: {} }, client);
    } else if (!res.writableEnded) res.end();
    return true;
  }
  return false;
}
