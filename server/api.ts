import type { IncomingMessage, ServerResponse } from "node:http";
import { createReadStream } from "node:fs";
import { randomUUID } from "node:crypto";
import { inspectProject, expandPath } from "./inspect.ts";
import {
  getSnapshot,
  listSnapshots,
  onProcessEvent,
  startProject,
  stopProject,
} from "./processes.ts";
import { loadProjects, updateProjects } from "./store.ts";
import type { LaunchMode, Project, ProjectCommand } from "./types.ts";
import { appUrl, projectAppUrl } from "./paths.ts";
import { iconContentType, letterIconSvg, resolveProjectIcon } from "./favicon.ts";
import { listDirectories } from "./directories.ts";
import { pickFolder } from "./pick-folder.ts";
import { basename } from "node:path";
import { runInstallerAgent } from "./qwen/agent.ts";
import { HttpError } from "./qwen/http.ts";
import {
  envFallbackFromProcess,
  loadPublicProviders,
  saveProviders,
  setActiveProvider,
} from "./qwen/provider-store.ts";
import type { AgentHistoryTurn, OpenAIProviderWrite } from "./qwen/types.ts";
import {
  openBrowser,
  openLauncher,
  hidePalette,
  openWindow,
  startTray,
  quitDesktop,
} from "./window.ts";
import {
  applicationIcon,
  interfaceMode,
  launchItem,
  preferences,
  saveInterface,
  searchLauncher,
  shortcuts,
  checkShortcut,
  shortcutStatus,
} from "./launcher.ts";

import { listIntegrations } from "./integrations/index.ts";
import {
  configureGithub,
  connectGithub,
  disconnectGithub,
  beginGithubLogin,
  pollGithubLogin,
  githubRepositories,
  importGithubProject,
} from "./integrations/github.ts";

import {
  closeProjectTerminals,
  terminalSessionSnapshot,
  stopTerminalSession,
  closeTerminalSession,
  createTerminalSession,
  listTerminalSessions,
  terminalRequestAllowed,
} from "./terminal.ts";

import {
  listProjectDirectory,
  readProjectFile,
  searchProject,
  projectGit,
  projectComparison,
} from "./workspace.ts";

interface SseClient {
  res: ServerResponse;
}

const sseClients = new Set<SseClient>();
let eventsBound = false;

function json(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};
  return JSON.parse(raw) as Record<string, unknown>;
}

function bindEvents(): void {
  if (eventsBound) return;
  eventsBound = true;
  onProcessEvent((event, data) => {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of sseClients) client.res.write(payload);
  });
}

function attachSse(req: IncomingMessage, res: ServerResponse): void {
  bindEvents();
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
  });
  res.write(":\n\n");
  const client = { res };
  sseClients.add(client);
  req.on("close", () => sseClients.delete(client));
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function parseCommands(value: unknown): ProjectCommand[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    const name = asString(row.name);
    const cmd = asString(row.cmd);
    if (!name || !cmd) return [];
    return [{ id: asString(row.id) || randomUUID(), name, cmd }];
  });
}

function parseMode(value: unknown): LaunchMode {
  return value === "window" ? "window" : "server";
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function sendIconFile(res: ServerResponse, file: string): void {
  res.statusCode = 200;
  res.setHeader("Content-Type", iconContentType(file));
  res.setHeader("Cache-Control", "no-cache");
  createReadStream(file).pipe(res);
}

function sendLetterIcon(res: ServerResponse, name: string): void {
  res.statusCode = 200;
  res.setHeader("Content-Type", "image/svg+xml");
  res.setHeader("Cache-Control", "no-cache");
  res.end(letterIconSvg(name));
}

function launchHtml(project: Project, target: string): string {
  const title = escapeHtml(project.name);
  const href = `/api/projects/${encodeURIComponent(project.id)}/icon`;
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<title>${title}</title>
<link rel="icon" href="${href}">
<link rel="shortcut icon" href="${href}">
<meta http-equiv="refresh" content="0;url=${escapeHtml(target)}">
<style>html,body{margin:0;background:#111;color:#aaa;font:14px sans-serif;height:100%}body{display:grid;place-items:center}</style>
</head>
<body>
<p>открываю ${title}…</p>
<script>location.replace(${JSON.stringify(target)})</script>
</body>
</html>`;
}

function normalizeProject(input: Record<string, unknown>, current?: Project): Project {
  const commands = parseCommands(input.commands);
  if (commands.length === 0) throw new Error("Нужна хотя бы одна команда");
  const defaultCommandId =
    asString(input.defaultCommandId) || current?.defaultCommandId || commands[0].id;
  return {
    id: current?.id ?? randomUUID(),
    name: asString(input.name) || "без имени",
    path: asString(input.path),
    url: asString(input.url),
    icon: asString(input.icon) || current?.icon || "",
    mode: parseMode(input.mode),
    defaultCommandId: commands.some((item) => item.id === defaultCommandId)
      ? defaultCommandId
      : commands[0].id,
    commands,
    createdAt: current?.createdAt ?? new Date().toISOString(),
  };
}

function withRuntime(project: Project) {
  return { ...project, runtime: getSnapshot(project.id) };
}

export async function handleApi(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const host = req.headers.host ?? "localhost";
  const url = new URL(req.url ?? "/", `http://${host}`);
  if (!url.pathname.startsWith("/api")) return false;

  const method = req.method ?? "GET";
  const path = url.pathname;

  try {
    // Only our local UI may invoke operations on the host system.
    const origin = req.headers.origin;
    if (origin && origin !== url.origin) {
      json(res, 403, { error: "Запрос разрешён только со страницы Projector" });
      return true;
    }
    if (
      /^\/api\/projects\/[^/]+\/terminals(?:\/|$)/.test(path) &&
      !terminalRequestAllowed(req, false)
    ) {
      json(res, 403, { error: "Терминал доступен только со страницы Projector" });
      return true;
    }
    if (path.startsWith("/api/integrations")) {
      res.setHeader("Cache-Control", "no-store");
      if (path === "/api/integrations" && method === "GET") {
        json(res, 200, await listIntegrations());
        return true;
      }
      if (path === "/api/integrations/github" && method === "PUT") {
        json(res, 200, await configureGithub(await readBody(req)));
        return true;
      }
      if (path === "/api/integrations/github/auth" && method === "POST") {
        json(res, 200, await connectGithub(await readBody(req)));
        return true;
      }
      if (path === "/api/integrations/github/auth" && method === "DELETE") {
        json(res, 200, await disconnectGithub());
        return true;
      }
      if (path === "/api/integrations/github/device" && method === "POST") {
        json(res, 200, await beginGithubLogin());
        return true;
      }
      if (path === "/api/integrations/github/device/poll" && method === "POST") {
        json(res, 200, await pollGithubLogin(await readBody(req)));
        return true;
      }
      if (path === "/api/integrations/github/repositories" && method === "GET") {
        json(res, 200, await githubRepositories(Number(url.searchParams.get("page") ?? 1)));
        return true;
      }
      if (path === "/api/integrations/github/import" && method === "POST") {
        const result = await importGithubProject(await readBody(req));
        json(res, 201, { project: withRuntime(result.project) });
        return true;
      }
    }

    if (path === "/api/directories" && method === "GET") {
      if (!terminalRequestAllowed(req, false)) throw new HttpError(403, "Папки доступны только со страницы Projector");
      res.setHeader("Cache-Control", "no-store");
      json(
        res,
        200,
        await listDirectories(
          url.searchParams.get("path") ?? "",
          url.searchParams.get("complete") === "true",
        ),
      );
      return true;
    }

    if (path === "/api/health" && method === "GET") {
      json(res, 200, { ok: true, app: "projector", pid: process.pid, url: appUrl() });
      return true;
    }

    if (path === "/api/app/open" && method === "POST") {
      const body = await readBody(req);
      if (body.tray === true) {
        await startTray(appUrl());
        json(res, 200, { ok: true });
        return true;
      }
      const mode = await openLauncher(
        appUrl(),
        body.mode ? interfaceMode(body.mode) : undefined,
        body.toggle === true,
      );
      if (mode === "window") {
        for (const client of sseClients) client.res.write("event: launcher-show\ndata: {}\n\n");
      }
      json(res, 200, { ok: true, url: appUrl(), mode });
      return true;
    }

    if (path === "/api/app/hide" && method === "POST") {
      hidePalette();
      json(res, 200, { ok: true });
      return true;
    }

    if (path === "/api/app/quit" && method === "POST") {
      await quitDesktop(appUrl());
      json(res, 200, { ok: true });
      setTimeout(() => process.exit(0), 100).unref();
      return true;
    }

    if (path === "/api/launcher/settings" && method === "GET") {
      const prefs = await preferences();
      json(res, 200, {
        mode: prefs.mode,
        shortcut: prefs.shortcut,
        hotkey: await shortcutStatus(),
      });
      return true;
    }
    if (path === "/api/launcher/settings" && method === "PUT") {
      const body = await readBody(req);
      if (!["native", "window", "browser"].includes(asString(body.mode))) throw new Error("Неизвестный режим интерфейса");
      const mode = interfaceMode(body.mode);
      const shortcut = body.shortcut === undefined ? undefined : asString(body.shortcut);
      if (shortcut !== undefined && !shortcuts.includes(shortcut)) throw new Error("Неизвестное сочетание клавиш");
      if (shortcut !== undefined) await checkShortcut(shortcut);
      await saveInterface(mode, shortcut);
      // Update an existing resident process without showing its palette.
      if (shortcut !== undefined) await startTray(appUrl()).catch(() => undefined);
      const prefs = await preferences();
      json(res, 200, { mode, shortcut: prefs.shortcut, hotkey: await shortcutStatus() });
      return true;
    }
    if (path === "/api/launcher/search" && method === "GET") {
      json(res, 200, await searchLauncher(url.searchParams.get("q") ?? ""));
      return true;
    }
    if (path === "/api/launcher/launch" && method === "POST") {
      const body = await readBody(req);
      await launchItem(asString(body.id));
      json(res, 200, { ok: true });
      return true;
    }
    if (path === "/api/launcher/icon" && method === "GET") {
      const id = url.searchParams.get("id") ?? "";
      const file = await applicationIcon(id).catch(() => null);
      if (file) sendIconFile(res, file);
      else sendLetterIcon(res, id);
      return true;
    }

    if (path === "/api/events" && method === "GET") {
      attachSse(req, res);
      return true;
    }

    if (path === "/api/status" && method === "GET") {
      json(res, 200, { processes: listSnapshots() });
      return true;
    }

    if (path === "/api/providers" && method === "GET") {
      json(res, 200, await loadPublicProviders(envFallbackFromProcess()));
      return true;
    }

    if (path === "/api/providers" && method === "PUT") {
      const body = await readBody(req);
      const providers = Array.isArray(body.providers) ? body.providers : [];
      json(
        res,
        200,
        await saveProviders(
          {
            activeProviderId: typeof body.activeProviderId === "string" ? body.activeProviderId : null,
            providers: providers as OpenAIProviderWrite[],
          },
          envFallbackFromProcess(),
        ),
      );
      return true;
    }

    if (path === "/api/providers/active" && method === "PATCH") {
      const body = await readBody(req);
      json(res, 200, await setActiveProvider(asString(body.id), envFallbackFromProcess()));
      return true;
    }

    if (path === "/api/agent" && method === "POST") {
      const body = await readBody(req);
      const message = asString(body.message);
      if (!message) throw new Error("Напишите, какой проект добавить");
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

      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      });
      const abort = new AbortController();
      req.on("close", () => abort.abort());
      const emit = (event: string, data: unknown) => {
        if (!res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      };
      try {
        await runInstallerAgent({
          message,
          history,
          providerId: asString(body.providerId) || undefined,
          abort: abort.signal,
          emit,
        });
      } catch (error) {
        const text = error instanceof Error ? error.message : "Ошибка агента";
        emit("error", { error: text });
      }
      if (!res.writableEnded) res.end();
      return true;
    }

    if (path === "/api/inspect" && method === "POST") {
      const body = await readBody(req);
      const result = await inspectProject(asString(body.path));
      json(res, 200, result);
      return true;
    }

    if (path === "/api/pick-folder" && method === "POST") {
      const picked = await pickFolder();
      json(res, 200, { path: picked, cancelled: !picked });
      return true;
    }

    if (path === "/api/preview-icon" && method === "GET") {
      const projectPath = expandPath(asString(url.searchParams.get("path")));
      if (!projectPath) throw new Error("Укажите путь");
      const file = await resolveProjectIcon(projectPath, null);
      if (file) sendIconFile(res, file);
      else sendLetterIcon(res, basename(projectPath));
      return true;
    }

    if (path === "/api/projects" && method === "GET") {
      const projects = await loadProjects();
      json(res, 200, { projects: projects.map(withRuntime) });
      return true;
    }

    if (path === "/api/projects" && method === "POST") {
      const body = await readBody(req);
      const project = normalizeProject(body);
      if (!project.path) throw new Error("Укажите путь к проекту");
      await updateProjects((projects) => {
        projects.unshift(project);
      });
      json(res, 201, { project: withRuntime(project) });
      return true;
    }

    const projectMatch = path.match(/^\/api\/projects\/([^/]+)(?:\/([^/]+))?(?:\/([^/]+))?$/);
    if (projectMatch) {
      const [, id, action, sessionId] = projectMatch;
      const projects = await loadProjects();
      const index = projects.findIndex((item) => item.id === id);
      if (index === -1) {
        json(res, 404, { error: "Проект не найден" });
        return true;
      }
      const project = projects[index];

      if (action === "workspace" && method === "GET") {
        if (!terminalRequestAllowed(req, false)) throw new HttpError(403, "Обзор доступен только со страницы Projector");
        res.setHeader("Cache-Control", "no-store");
        const filePath = url.searchParams.get("path") ?? "";
        if (sessionId === "tree") json(res, 200, await listProjectDirectory(project.path, filePath));
        else if (sessionId === "file") json(res, 200, await readProjectFile(project.path, filePath));
        else if (sessionId === "search") json(res, 200, await searchProject(project.path, url.searchParams.get("q") ?? ""));
        else if (sessionId === "git") json(res, 200, await projectGit(project.path));
        else if (sessionId === "diff")
          json(
            res,
            200,
            await projectComparison(
              project.path,
              filePath,
              url.searchParams.get("staged") === "true",
            ),
          );
        else json(res, 404, { error: "Не найден" });
        return true;
      }

      if (action === "terminals") {
        if (!sessionId && method === "GET") {
          json(res, 200, { sessions: listTerminalSessions(id) });
          return true;
        }
        if (!sessionId && method === "POST") {
          json(res, 201, { session: createTerminalSession(project, await readBody(req)) });
          return true;
        }
        if (sessionId && method === "POST") {
          const previous = listTerminalSessions(id).find((item) => item.id === sessionId);
          if (!previous) throw new HttpError(404, "Терминал не найден");
          const body = await readBody(req);
          if (body.action === "stop") {
            const running = getSnapshot(id);
            if (previous.commandId && running.pid === previous.pid && running.status === "running")
              stopProject(id);
            else stopTerminalSession(id, sessionId);
            json(res, 200, {
              session: listTerminalSessions(id).find((item) => item.id === sessionId),
            });
          } else if (body.action === "restart") {
            if (previous.status !== "exited") throw new HttpError(409, "Сначала завершите сессию");
            let session;
            if (previous.commandId) {
              if (!project.commands.some((command) => command.id === previous.commandId))
                throw new HttpError(400, "Команда проекта больше не существует");
              const running = startProject(project, previous.commandId, "server", previous.id);
              session = listTerminalSessions(id).find((item) => item.pid === running.pid);
            } else {
              session = createTerminalSession(
                project,
                { program: previous.program },
                undefined,
                previous.id,
              );
            }
            json(res, 201, { session });
          } else throw new HttpError(400, "Неизвестное действие с сессией");
          return true;
        }
        if (sessionId && method === "GET") {
          const session = terminalSessionSnapshot(id, sessionId);
          if (!session) throw new HttpError(404, "Терминал не найден");
          res.setHeader("Cache-Control", "no-store");
          json(res, 200, { session });
          return true;
        }
        if (sessionId && method === "DELETE") {
          const body = await readBody(req);
          const session = terminalSessionSnapshot(id, sessionId);
          if (session) {
            if (
              session.activity?.state !== "idle" &&
              body.confirmation !== session.activity?.confirmation
            ) {
              json(res, 409, { error: "Подтвердите прерывание процессов", session });
              return true;
            }
          }
          closeTerminalSession(id, sessionId);
          json(res, 200, { ok: true });
          return true;
        }
      }
      if (sessionId) {
        json(res, 404, { error: "Не найден" });
        return true;
      }

      if (!action && method === "GET") {
        json(res, 200, { project: withRuntime(project) });
        return true;
      }

      if (!action && method === "PATCH") {
        const body = await readBody(req);
        const next = normalizeProject({ ...project, ...body }, project);
        await updateProjects((current) => {
          const currentIndex = current.findIndex((item) => item.id === id);
          if (currentIndex === -1) throw new HttpError(404, "Проект не найден");
          current[currentIndex] = next;
        });
        json(res, 200, { project: withRuntime(next) });
        return true;
      }

      if (!action && method === "DELETE") {
        stopProject(id);
        closeProjectTerminals(id);
        await updateProjects((current) => {
          const currentIndex = current.findIndex((item) => item.id === id);
          if (currentIndex !== -1) current.splice(currentIndex, 1);
        });
        json(res, 200, { ok: true });
        return true;
      }

      if (action === "start" && method === "POST") {
        const body = await readBody(req);
        const runtime = startProject(
          project,
          asString(body.commandId) || undefined,
          parseMode(body.mode),
        );
        json(res, 200, { runtime });
        return true;
      }

      if (action === "stop" && method === "POST") {
        json(res, 200, { runtime: stopProject(id) });
        return true;
      }

      if (action === "open" && method === "POST") {
        const body = await readBody(req);
        const runtime = getSnapshot(id);
        const target = runtime.url || project.url;
        if (!target) throw new Error("Нет адреса для открытия");
        if (parseMode(body.mode) === "window") openWindow(projectAppUrl(id));
        else openBrowser(target);
        json(res, 200, { ok: true, url: target });
        return true;
      }

      if (action === "icon" && method === "GET") {
        const file = await resolveProjectIcon(project.path, project.icon);
        if (file) sendIconFile(res, file);
        else sendLetterIcon(res, project.name);
        return true;
      }

      if (action === "app" && method === "GET") {
        const runtime = getSnapshot(id);
        const target = runtime.url || project.url;
        if (!target) throw new Error("Нет адреса для открытия");
        res.statusCode = 200;
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.setHeader("Cache-Control", "no-store");
        res.end(launchHtml(project, target));
        return true;
      }
    }

    json(res, 404, { error: "Не найден" });
    return true;
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 400;
    const message = error instanceof Error ? error.message : "Ошибка";
    json(res, status, { error: message });
    return true;
  }
}
