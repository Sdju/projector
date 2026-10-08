import {
  GUI_AGENT_PROGRAMS,
  preferences,
  setAgentDefault,
  setAgentMode,
} from "../../modules/preferences/index.ts";
import { loadProjects } from "../../modules/projects/index.ts";
import {
  AGENT_BACKEND_IDS,
  AGENT_PERMISSION_MODES,
  agentControls,
  agentSessions,
  loadAgentSession,
  selectionFrom,
  runAgent,
  createCommandBridge,
  createApprovalBridge,
  completeCommandRequest,
  cancelRun,
  createRun,
  pruneRuns,
  readRun,
  removeRun,
  schedulePrune,
  trackRun,
  HOSTED_AGENT_BACKENDS,
  readAgentHistory,
  writeAgentHistory,
} from "../../modules/agent/index.ts";

import type { AgentHistoryTurn } from "../../modules/providers/index.ts";

import { readBody, asString, json } from "../../modules/transport/index.ts";

import type { RouteContext } from "../../modules/transport/index.ts";

async function projectPath(projectId: string): Promise<string> {
  const project = (await loadProjects()).find((item) => item.id === projectId);
  if (!project) throw new Error("Проект не найден");
  return project.path;
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
    const cwd = await projectPath(url.searchParams.get("projectId") ?? "");
    const backend = url.searchParams.get("backend") ?? undefined;
    json(res, 200, { controls: await agentControls(backend, cwd) });
    return true;
  }
  if (path === "/api/agent/sessions" && method === "GET") {
    const cwd = await projectPath(url.searchParams.get("projectId") ?? "");
    const backend = url.searchParams.get("backend") ?? undefined;
    json(res, 200, { sessions: await agentSessions(backend, cwd) });
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
    const request = stored ?? (await requestFrom(body));
    const backend = request.backend;
    const hosted = HOSTED_AGENT_BACKENDS.includes(backend);
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
    try {
      await runAgent({
        ...request,
        backend,
        run,
        commands: body.commandBridge === true ? createCommandBridge(emit, abort.signal) : undefined,
        approve: body.approvals === true ? createApprovalBridge(emit, abort.signal) : undefined,
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

/** A new request from the body of `POST /api/agent`. */
async function requestFrom(body: Record<string, unknown>) {
  const message = asString(body.message);
  if (!message) throw new Error("Напишите сообщение агенту");
  const projectId = asString(body.projectId);
  const project = projectId
    ? (await loadProjects()).find((item) => item.id === projectId)
    : undefined;
  if (projectId && !project) throw new Error("Проект не найден");
  const history = Array.isArray(body.history)
    ? body.history.flatMap((item): AgentHistoryTurn[] => {
        if (!item || typeof item !== "object") return [];
        const row = item as Record<string, unknown>;
        const role = row.role === "assistant" ? "assistant" : row.role === "user" ? "user" : null;
        const content = asString(row.content);
        if (!role || !content) return [];
        return [{ role, content }];
      })
    : [];
  return {
    message,
    history,
    backend: AGENT_BACKEND_IDS.find((id) => id === body.backend) ?? "projector",
    permissionMode: AGENT_PERMISSION_MODES.find((mode) => mode === body.permissionMode),
    selection: selectionFrom(body.selection),
    sessionId: asString(body.sessionId) || undefined,
    cwd: project?.path,
    providerId: asString(body.providerId) || undefined,
  };
}
