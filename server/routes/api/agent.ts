import {
  GUI_AGENT_PROGRAMS,
  preferences,
  setAgentDefault,
  setAgentMode,
} from "../../modules/preferences/index.ts";
import { loadProjects } from "../../modules/projects/index.ts";
import {
  resolveAgentBackend,
  agentCommands,
  agentControls,
  agentCapabilities,
  agentMcpServers,
  agentSessions,
  rewindAgentFiles,
  updateAgentSession,
  deleteAgentSession,
  loadAgentSession,
  selectionFrom,
  runAgent,
  createCommandBridge,
  createApprovalBridge,
  createQuestionBridge,
  createSecretBridge,
  completeCommandRequest,
  cancelRun,
  createRun,
  pruneRuns,
  readRun,
  removeRun,
  schedulePrune,
  trackRun,
  isHostedAgent,
  createWorktree,
  injectMessage,
  worktreeCwd,
  readAgentHistory,
  readAttachment,
  saveAttachment,
  writeAgentHistory,
} from "../../modules/agent/index.ts";

import type { AgentHistoryTool, AgentHistoryTurn } from "../../modules/providers/index.ts";

import { accessAllowed } from "../../modules/access/index.ts";
import { HttpError } from "../../modules/http/index.ts";
import { readBody, asString, json } from "../../modules/transport/index.ts";

import type { MessagePart } from "../../modules/agent/index.ts";
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
    const turns =
      method === "GET"
        ? await readAgentHistory(id)
        : await writeAgentHistory(id, (await readBody(req)).turns);
    json(res, 200, { turns });
    return true;
  }
  if (path === "/api/agent/modes" && method === "GET") {
    json(res, 200, { modes: (await preferences()).agentModes, programs: GUI_AGENT_PROGRAMS });
    return true;
  }
  if (path === "/api/agent/modes" && method === "PUT") {
    const body = await readBody(req);
    if (body.mode !== "tui" && body.mode !== "gui") throw new Error("Неизвестный режим сессии");
    await setAgentMode(asString(body.program), body.mode);
    json(res, 200, { modes: (await preferences()).agentModes, programs: GUI_AGENT_PROGRAMS });
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
    const cwd = await projectPath(url.searchParams.get("projectId") ?? "");
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
    const accepted = injectMessage(asString(body.messageId), text);
    json(res, accepted ? 200 : 410, { accepted });
    return true;
  }
  if (path === "/api/agent/cancel" && method === "POST") {
    const body = await readBody(req);
    await cancelRun(asString(body.runId));
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
      approvals: body.approvals === true,
      commandBridge: body.commandBridge === true,
    };
    const backend = request.backend;
    const hosted = isHostedAgent(backend);
    const run = hosted
      ? { id: attachId || (await createRun(request)), attach: !!attachId }
      : undefined;
    if (hosted && !attachId) void pruneRuns().catch(() => {});

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    });
    // A closed page only detaches from a hosted run, which keeps going and can be rejoined;
    // other agents stop with their request. Stopping a hosted run is the explicit cancel.
    const abort = new AbortController();
    let detached = false;
    res.on("close", () => {
      detached = true;
      if (!hosted) abort.abort();
    });
    const untrack = run ? trackRun(run.id, () => abort.abort()) : undefined;
    let delivered = false;
    const emit = (event: string, data: unknown) => {
      if (detached || res.writableEnded) return;
      if (event === "done" || event === "error") delivered = true;
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
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
    if (run && (delivered || abort.signal.aborted)) await removeRun(run.id).catch(() => {});
    else if (run) schedulePrune();
    if (!res.writableEnded) res.end();
    return true;
  }
  return false;
}

/** Calls an earlier answer made; malformed ones are dropped, sizes bounded. */
function historyTools(value: unknown): AgentHistoryTool[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 100).flatMap((item): AgentHistoryTool[] => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    const id = asString(row.id);
    const name = asString(row.name);
    if (!id || !name) return [];
    return [
      {
        id: id.slice(0, 200),
        name: name.slice(0, 100),
        ...(typeof row.input === "string" ? { input: row.input.slice(0, 20_000) } : {}),
        output: asString(row.output).slice(0, 20_000),
        ...(row.failed === true ? { failed: true } : {}),
      },
    ];
  });
}

/** The chips of a message; anything that is not a well-formed part is dropped. */
function partsFrom(value: unknown): MessagePart[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const parts = value.flatMap((item): MessagePart[] => {
    if (!item || typeof item !== "object") return [];
    const part = item as Record<string, unknown>;
    if (part.type === "text" && typeof part.text === "string")
      return [{ type: "text", text: part.text }];
    if (part.type === "file" && typeof part.path === "string" && part.path)
      return [{ type: "file", path: part.path, directory: part.directory === true || undefined }];
    if (part.type === "command" && typeof part.name === "string" && part.name)
      return [{ type: "command", name: part.name }];
    if (
      part.type === "image" &&
      typeof part.id === "string" &&
      typeof part.name === "string" &&
      typeof part.mime === "string"
    )
      return [{ type: "image", id: part.id, name: part.name, mime: part.mime }];
    return [];
  });
  return parts.some((part) => part.type !== "text") ? parts.slice(0, 200) : undefined;
}

/** A new request from the body of `POST /api/agent`. */
async function requestFrom(body: Record<string, unknown>) {
  const message = asString(body.message);
  if (!message) throw new Error("Напишите сообщение агенту");
  const projectId = asString(body.projectId);
  const project = projectId
    ? (await loadProjects()).find((item) => item.id === projectId)
    : undefined;
  if (projectId && !project) throw new Error("Проект не найден");
  let folder = project?.path;
  let worktree: { id: string; branch: string } | undefined;
  const reused = asString(body.worktree);
  if (project && reused) folder = await worktreeCwd(project.id, reused, project.path);
  else if (project && body.isolate === true && !asString(body.sessionId)) {
    const copy = await createWorktree(project.id, project.path);
    folder = copy.cwd;
    worktree = { id: copy.id, branch: copy.branch };
  }
  const history = Array.isArray(body.history)
    ? body.history.flatMap((item): AgentHistoryTurn[] => {
        if (!item || typeof item !== "object") return [];
        const row = item as Record<string, unknown>;
        const role = row.role === "assistant" ? "assistant" : row.role === "user" ? "user" : null;
        const content = asString(row.content);
        const tools = historyTools(row.tools);
        if (!role || (!content && !tools.length)) return [];
        return [{ role, content, ...(tools.length ? { tools } : {}) }];
      })
    : [];
  const request = {
    message,
    parts: partsFrom(body.parts),
    history,
    backend: resolveAgentBackend(body.backend),
    permissionMode: asString(body.permissionMode) || undefined,
    selection: selectionFrom(body.selection),
    sessionId: asString(body.sessionId) || undefined,
    messageId: asString(body.messageId) || undefined,
    tail: asString(body.tail) || undefined,
    cwd: folder,
    providerId: asString(body.providerId) || undefined,
  };
  return { request, worktree };
}
