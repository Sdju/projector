import {
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
  agentSessions,
  rewindAgentFiles,
  updateAgentSession,
  deleteAgentSession,
  loadAgentSession,
  completeCommandRequest,
  cancelRun,
  listLiveRuns,
  listAgentBackends,
  injectMessage,
  worktreeCwd,
  readAgentHistory,
  readChatFeatures,
  readChatJudge,
  readRecentChats,
  readAttachment,
  saveAttachment,
  writeAgentHistory,
  detachEventStream,
  type AgentSessionInfo,
  type AgentSessionTurn,
  handleAgentRun,
} from "../../modules/agent/index.ts";

import { accessAllowed } from "../../modules/access/index.ts";
import {
  FEATURE_PROMPT_END,
  featurePrompt,
  sessionTitleWithoutInjected,
  splitFeaturePrompt,
} from "../../modules/agent-features/index.ts";
import { HttpError } from "../../modules/http/index.ts";
import { readBody, asString, json } from "../../modules/transport/index.ts";

import type { RouteDefinition, RouteHandler } from "../../modules/transport/index.ts";

const route = (method: string, path: string, handler: RouteHandler): RouteDefinition => ({
  method,
  path,
  handler,
});

async function projectPath(projectId: string): Promise<string> {
  const project = (await loadProjects()).find((item) => item.id === projectId);
  if (!project) throw new Error("Проект не найден");
  return project.path;
}

/**
 * A native session keeps the first message exactly as Projector sent it: the abilities injected
 * before the user's words. The chat shows the user's message as written and puts the injected
 * text into its own collapsible block; the transcript itself stays untouched.
 */
async function withoutInjected(
  turns: AgentSessionTurn[],
  backend: string,
  projectId: string,
  sessionId: string,
): Promise<AgentSessionTurn[]> {
  const index = turns.findIndex((turn) => turn.role === "user");
  if (index < 0) return turns;
  const chat = projectId
    ? readRecentChats(projectId, backend).find((item) => item.session === sessionId)?.chat
    : undefined;
  // Sessions written before the end marker are matched against the same abilities, when they
  // still match: a changed feature list leaves the message as it is instead of cutting it.
  const legacy = (await featurePrompt(backend, chat ? readChatFeatures(chat) : undefined))
    .replace(FEATURE_PROMPT_END, "")
    .trim();
  const turn = turns[index]!;
  const split = splitFeaturePrompt(turn.text, legacy);
  if (!split.injected && split.text === turn.text) return turns;
  return turns.map((item, at) =>
    at === index
      ? { ...item, text: split.text, ...(split.injected ? { injected: split.injected } : {}) }
      : item,
  );
}

/** The folder a chat's agent works in: the project, or the isolated copy the chat was given. */
async function agentFolder(projectId: string, worktree: string): Promise<string> {
  const path = await projectPath(projectId);
  return worktree ? worktreeCwd(projectId, worktree, path) : path;
}

/**
 * Some agents name a session after its first prompt, which for Projector is the injected abilities
 * text. The list shows the user's own words instead; a title that cannot be split (an old or
 * truncated one) falls back to the name of the chat that continued the session.
 */
async function withoutInjectedTitles(
  sessions: AgentSessionInfo[],
  backend: string,
  projectId: string,
): Promise<AgentSessionInfo[]> {
  const suspicious = (title: string) =>
    title.includes(FEATURE_PROMPT_END) || title.startsWith("[Projector]");
  if (!sessions.some((session) => suspicious(session.title))) return sessions;
  const chats = projectId ? readRecentChats(projectId, backend) : [];
  const chatOf = new Map(
    chats.flatMap((chat) => (chat.session ? [[chat.session, chat] as const] : [])),
  );
  const prompts = new Map<string, string>();
  const legacyOf = async (chat?: string) => {
    const key = chat ?? "";
    const known = prompts.get(key);
    if (known !== undefined) return known;
    const prompt = (await featurePrompt(backend, chat ? readChatFeatures(chat) : undefined))
      .replace(FEATURE_PROMPT_END, "")
      .trim();
    prompts.set(key, prompt);
    return prompt;
  };
  return Promise.all(
    sessions.map(async (session) => {
      if (!suspicious(session.title)) return session;
      const chat = chatOf.get(session.id);
      const title = sessionTitleWithoutInjected(session.title, await legacyOf(chat?.chat));
      if (title !== session.title) return { ...session, title };
      return chat?.title ? { ...session, title: chat.title } : session;
    }),
  );
}

/** Terminal programs of the registered chat backends, in registration order. */
function agentPrograms(): string[] {
  return listAgentBackends().flatMap(({ program }) => (program ? [program] : []));
}

async function modeState() {
  const prefs = await preferences();
  return {
    modes: prefs.agentModes,
    programs: agentPrograms(),
    disabled: prefs.disabledAgents,
  };
}

async function defaultsState() {
  return { defaults: (await preferences()).agentDefaults };
}

function historyState<Turns>(id: string, turns: Turns) {
  return {
    turns,
    features: readChatFeatures(id) ?? null,
    judge: readChatJudge(id) ?? null,
  };
}

export const routes: RouteDefinition[] = [
  route("GET", "/api/agent/history/:id", async ({ res, params }) => {
    const id = decodeURIComponent(params.id!);
    json(res, 200, historyState(id, await readAgentHistory(id)));
  }),
  route("PUT", "/api/agent/history/:id", async ({ req, res, params }) => {
    const id = decodeURIComponent(params.id!);
    const body = await readBody(req);
    const project = asString(body.projectId);
    const backend = asString(body.backend);
    const title = asString(body.title);
    const turns = await writeAgentHistory(
      id,
      body.turns,
      project && backend ? { project, backend, ...(title ? { title } : {}) } : undefined,
      body.features,
      body.judge,
    );
    json(res, 200, historyState(id, turns));
  }),
  route("GET", "/api/agent/backends", ({ res }) => {
    json(res, 200, { backends: listAgentBackends() });
  }),
  route("GET", "/api/agent/modes", async ({ res }) => {
    json(res, 200, await modeState());
  }),
  route("PUT", "/api/agent/modes", async ({ req, res }) => {
    const body = await readBody(req);
    if (body.mode !== "tui" && body.mode !== "gui") throw new Error("Неизвестный режим сессии");
    await setAgentMode(asString(body.program), body.mode);
    json(res, 200, await modeState());
  }),
  route("PUT", "/api/agent/integrations", async ({ req, res }) => {
    const body = await readBody(req);
    if (typeof body.enabled !== "boolean") throw new Error("Укажите, включён ли агент");
    await setAgentEnabled(asString(body.backend), body.enabled);
    json(res, 200, { disabled: (await preferences()).disabledAgents });
  }),
  route("POST", "/api/agent/attachments", async ({ req, res, url }) => {
    if (!accessAllowed(req, true))
      throw new HttpError(403, "Загрузка доступна только со страницы Projector");
    const type = (req.headers["content-type"] ?? "").split(";")[0]!.trim();
    json(res, 201, await saveAttachment(req, type, url.searchParams.get("name") ?? ""));
  }),
  route("GET", "/api/agent/attachments/:id([0-9a-f]+)", async ({ res, params }) => {
    const image = await readAttachment(params.id!);
    if (!image) throw new HttpError(404, "Изображение не найдено");
    res.setHeader("Content-Type", image.mime);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
    res.setHeader("Content-Security-Policy", "sandbox; default-src 'none'");
    res.end(image.content);
  }),
  route("GET", "/api/agent/defaults", async ({ res }) => {
    json(res, 200, await defaultsState());
  }),
  route("PUT", "/api/agent/defaults", async ({ req, res }) => {
    const body = await readBody(req);
    await setAgentDefault(asString(body.backend), asString(body.id), asString(body.value));
    json(res, 200, await defaultsState());
  }),
  route("GET", "/api/agent/controls", async ({ res, url }) => {
    const projectId = url.searchParams.get("projectId") ?? "";
    // The Projector agent also works outside any project, on the catalog.
    const cwd = projectId ? await projectPath(projectId) : "";
    const backend = url.searchParams.get("backend") ?? undefined;
    json(res, 200, {
      controls: await agentControls(backend, cwd),
      capabilities: agentCapabilities(backend),
    });
  }),
  route("GET", "/api/agent/commands", async ({ res, url }) => {
    const projectId = url.searchParams.get("projectId") ?? "";
    const cwd = projectId ? await projectPath(projectId) : "";
    const backend = url.searchParams.get("backend") ?? undefined;
    json(res, 200, { commands: await agentCommands(backend, cwd) });
  }),
  route("POST", "/api/agent/rewind-files", async ({ req, res }) => {
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
  }),
  route("GET", "/api/agent/sessions", async ({ res, url }) => {
    const projectId = url.searchParams.get("projectId") ?? "";
    const cwd = await projectPath(projectId);
    const backend = url.searchParams.get("backend") ?? "";
    const sessions = await agentSessions(backend || undefined, cwd);
    json(res, 200, { sessions: await withoutInjectedTitles(sessions, backend, projectId) });
  }),
  route("POST", "/api/agent/sessions/update", async ({ req, res }) => {
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
  }),
  route("POST", "/api/agent/sessions/delete", async ({ req, res }) => {
    if (!accessAllowed(req, true))
      throw new HttpError(403, "Удаление доступно только со страницы Projector");
    const body = await readBody(req);
    const cwd = await projectPath(asString(body.projectId));
    const sessionId = asString(body.sessionId);
    if (!sessionId) throw new Error("Укажите сессию");
    await deleteAgentSession(asString(body.backend) || undefined, cwd, sessionId, {
      project: asString(body.projectId),
      ...(asString(body.chat) ? { keep: asString(body.chat) } : {}),
    });
    json(res, 200, { ok: true });
  }),
  route("POST", "/api/agent/sessions/load", async ({ req, res }) => {
    const body = await readBody(req);
    const project = asString(body.projectId);
    const backend = asString(body.backend);
    const cwd = await projectPath(project);
    const sessionId = asString(body.sessionId);
    if (!sessionId) throw new Error("Укажите сессию");
    const turns = await loadAgentSession(backend, cwd, sessionId);
    json(res, 200, { turns: await withoutInjected(turns, backend, project, sessionId) });
  }),
  route("POST", "/api/agent/tool-result", async ({ req, res }) => {
    const body = await readBody(req);
    const accepted = completeCommandRequest(asString(body.id), {
      output: body.output,
      error: asString(body.error) || undefined,
    });
    json(res, accepted ? 200 : 410, { accepted });
  }),
  route("POST", "/api/agent/inject", async ({ req, res }) => {
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
  }),
  route("GET", "/api/agent/runs", async ({ res }) => {
    json(res, 200, { runs: await listLiveRuns() });
  }),
  route("POST", "/api/agent/cancel", async ({ req, res }) => {
    const body = await readBody(req);
    await cancelRun(asString(body.runId));
    json(res, 200, { ok: true });
  }),
  route("POST", "/api/agent/detach", async ({ req, res }) => {
    const body = await readBody(req);
    detachEventStream(asString(body.stream));
    json(res, 200, { ok: true });
  }),
  route("POST", "/api/agent", async ({ req, res }) => {
    const body = await readBody(req);
    await handleAgentRun({ res, body });
  }),
];
