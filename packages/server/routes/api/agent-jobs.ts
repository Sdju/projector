import { stat } from "node:fs/promises";
import {
  answerJob,
  createWorktree,
  injectMessage,
  isAgentAvailable,
  isAgentBackend,
  isFinished,
  isHostedAgent,
  jobDiff,
  followUpJob,
  forkJob,
  listAgentBackends,
  listJobs,
  readJob,
  removeJob,
  removeWorktree,
  retryJob,
  selectionFrom,
  settleJobWorktree,
  startJob,
  stopJob,
  waitForJob,
  worktreeStatus,
} from "../../modules/agent/index.ts";
import { readAgentRole } from "../../modules/agent-roles/index.ts";
import { snapshotOfRole } from "@projector/core/modules/agent-role/index.ts";
import { accessAllowed } from "../../modules/access/index.ts";
import { HttpError } from "../../modules/http/index.ts";
import { loadProjects } from "../../modules/projects/index.ts";
import { asString, json, readBody } from "../../modules/transport/index.ts";
import type { RouteContext, RouteDefinition } from "../../modules/transport/index.ts";

/** The longest task text. */
const TASK_LIMIT = 20_000;
/** The longest wait of a long poll, in seconds. */
const WAIT_LIMIT = 45;

const pageOnly = (req: RouteContext["req"]) => {
  if (!accessAllowed(req, true)) throw new HttpError(403, "Доступно только со страницы Projector");
};

/** A new job from the body of `POST /api/agent/jobs`; everything the client sends is checked here. */
async function startFrom(body: Record<string, unknown>) {
  const projectId = asString(body.projectId);
  const roleId = asString(body.role).trim();
  const role = roleId ? await readAgentRole(roleId, projectId) : undefined;
  if (roleId && !role) throw new Error(`Неизвестная или недоверенная роль: ${roleId}`);
  if (role && role.kind !== "chat")
    throw new Error("Служебную роль нельзя запустить как фоновое задание");
  const backend = asString(body.backend).trim() || role?.agent || "";
  if (role && backend !== role.agent)
    throw new Error(`Роль «${role.name}» принадлежит агенту ${role.agent}`);
  const catalog = listAgentBackends();
  const isBuiltin = catalog.some(({ id, builtin }) => id === backend && builtin);
  if (!backend || isBuiltin || !isAgentBackend(backend)) {
    const names = catalog
      .filter(({ builtin }) => !builtin)
      .map(({ label }) => label)
      .join(", ");
    throw new Error(`Укажите внешнего агента: ${names}`);
  }
  if (!isHostedAgent(backend)) throw new Error("Этот агент не умеет работать в фоне");
  if (!isAgentAvailable(backend)) throw new Error("Программа этого агента не установлена");
  const task = asString(body.task).trim();
  if (!task) throw new Error("Опишите задание агенту");
  if (task.length > TASK_LIMIT) throw new Error(`Задание длиннее ${TASK_LIMIT} символов`);
  const project = (await loadProjects()).find((item) => item.id === asString(body.projectId));
  if (!project) throw new Error("Проект не найден");
  if (!(await stat(project.path).catch(() => null))?.isDirectory())
    throw new Error("Папка проекта не найдена");
  const selection = { ...role?.selection, ...selectionFrom(body.selection) };
  const mode =
    asString(body.mode) ||
    asString(body.permissionMode) ||
    role?.permissionMode ||
    selection.mode ||
    selection["permission-mode"] ||
    "";
  // Every agent reads the mode its own way: from `permissionMode` or from the selection.
  if (mode) {
    selection.mode = mode;
    selection["permission-mode"] = mode;
  }
  let cwd = project.path;
  let worktree: { id: string; branch: string } | undefined;
  if (body.isolate === true || role?.isolate === true) {
    const copy = await createWorktree(project.id, project.path);
    cwd = copy.cwd;
    worktree = { id: copy.id, branch: copy.branch };
  }
  try {
    return await startJob({
      backend,
      task,
      projectId: project.id,
      cwd,
      worktree,
      origin: asString(body.origin) || undefined,
      permissionMode: mode || undefined,
      selection,
      role: role ? snapshotOfRole(role) : undefined,
      unattended: body.unattended === true,
    });
  } catch (error) {
    if (worktree) await removeWorktree(project.id, worktree.id, project.path).catch(() => {});
    throw error;
  }
}

/** Background agent jobs: start, list, read with the journal, stop, answer and remove. */
export const routes: RouteDefinition[] = [
  {
    method: "GET",
    path: "/api/agent/jobs",
    handler: async ({ res, url }) => {
      json(res, 200, { jobs: await listJobs(url.searchParams.get("projectId") || undefined) });
    },
  },
  {
    method: "POST",
    path: "/api/agent/jobs",
    handler: async ({ req, res }) => {
      pageOnly(req);
      json(res, 201, { job: await startFrom(await readBody(req)) });
    },
  },
  {
    method: "GET",
    path: "/api/agent/jobs/:id([0-9a-f]{12})",
    handler: async ({ res, url, params }) => {
      const id = params.id!;
      const wait = Math.min(Math.max(Number(url.searchParams.get("wait")) || 0, 0), WAIT_LIMIT);
      const rev = Number(url.searchParams.get("rev"));
      const found =
        wait && Number.isFinite(rev) ? await waitForJob(id, rev, wait) : await readJob(id);
      if (!found) throw new HttpError(404, "Задание не найдено");
      json(res, 200, found);
    },
  },
  {
    method: "DELETE",
    path: "/api/agent/jobs/:id([0-9a-f]{12})",
    handler: async ({ req, res, params }) => {
      pageOnly(req);
      await removeJob(params.id!);
      json(res, 200, { ok: true });
    },
  },
  {
    method: "GET",
    path: "/api/agent/jobs/:id([0-9a-f]{12})/diff",
    handler: async ({ res, url, params }) => {
      const found = await readJob(params.id!);
      if (!found) throw new HttpError(404, "Задание не найдено");
      if (found.job.worktreeCleared)
        throw new HttpError(409, "Изолированная копия удалена или передана другому заданию");
      const limit = Number(url.searchParams.get("limit"));
      json(res, 200, {
        diff: await jobDiff(found.job.cwd, limit || undefined, found.job.base, found.job.dirty),
      });
    },
  },
  {
    method: "POST",
    path: "/api/agent/jobs/:id([0-9a-f]{12})/send",
    handler: async ({ req, res, params }) => {
      const id = params.id!;
      pageOnly(req);
      const found = await readJob(id);
      if (!found) throw new HttpError(404, "Задание не найдено");
      const text = asString((await readBody(req)).text).trim();
      if (!text) throw new HttpError(400, "Напишите уточнение агенту");
      if (isFinished(found.job.status)) {
        // A finished job takes a follow-up as a new run in the same record, copy and session.
        try {
          const job = await followUpJob(id, text);
          if (!job) throw new HttpError(404, "Задание не найдено");
          json(res, 200, { accepted: true, continued: true, job });
        } catch (error) {
          const message = error instanceof Error ? error.message : "";
          if (/ещё работает|уже занята/.test(message)) throw new HttpError(409, message);
          throw error;
        }
        return;
      }
      const accepted = await injectMessage(found.job.messageId, text);
      json(res, 200, { accepted, continued: false });
    },
  },
  {
    method: "POST",
    path: "/api/agent/jobs/:id([0-9a-f]{12})/retry",
    handler: async ({ req, res, params }) => {
      const id = params.id!;
      pageOnly(req);
      const body = await readBody(req);
      const task = asString(body.task).trim() || undefined;
      if (task && task.length > TASK_LIMIT)
        throw new Error(`Задание длиннее ${TASK_LIMIT} символов`);
      const found = await readJob(id);
      if (!found) throw new HttpError(404, "Задание не найдено");
      if (!isHostedAgent(found.job.backend) || !isAgentAvailable(found.job.backend))
        throw new Error("Агент этого задания больше не может работать в фоне");
      let job;
      try {
        job = await retryJob(id, task, body.append === true);
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        if (/ещё работает|уже занята/.test(message)) throw new HttpError(409, message);
        throw error;
      }
      json(res, 201, { job });
    },
  },
  {
    method: "POST",
    path: "/api/agent/jobs/:id([0-9a-f]{12})/fork",
    handler: async ({ req, res, params }) => {
      const id = params.id!;
      pageOnly(req);
      const task = asString((await readBody(req)).task).trim() || undefined;
      if (task && task.length > TASK_LIMIT)
        throw new Error(`Задание длиннее ${TASK_LIMIT} символов`);
      try {
        const job = await forkJob(id, task);
        if (!job) throw new HttpError(404, "Задание не найдено");
        json(res, 201, { job });
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        if (/Дождитесь|уже занята/.test(message)) throw new HttpError(409, message);
        throw error;
      }
    },
  },
  {
    method: "GET",
    path: "/api/agent/jobs/:id([0-9a-f]{12})/worktree",
    handler: async ({ res, params }) => {
      const found = await readJob(params.id!);
      if (!found) throw new HttpError(404, "Задание не найдено");
      if (!found.job.worktree) {
        json(res, 200, { worktree: null });
        return;
      }
      const project = (await loadProjects()).find((item) => item.id === found.job.projectId);
      if (!project) throw new HttpError(404, "Проект не найден");
      json(res, 200, {
        worktree: await worktreeStatus(project.id, found.job.worktree.id, project.path),
      });
    },
  },
  {
    method: "POST",
    path: "/api/agent/jobs/:id([0-9a-f]{12})/worktree/merge",
    handler: async ({ req, res, params }) => {
      pageOnly(req);
      try {
        const result = await settleJobWorktree(params.id!, "merge");
        if (!result) throw new HttpError(404, "Задание не найдено");
        json(res, 200, result);
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        if (/Дождитесь|уже занята/.test(message)) throw new HttpError(409, message);
        if (/Проект не найден/.test(message)) throw new HttpError(404, message);
        throw error;
      }
    },
  },
  {
    method: "POST",
    path: "/api/agent/jobs/:id([0-9a-f]{12})/worktree/discard",
    handler: async ({ req, res, params }) => {
      pageOnly(req);
      try {
        const result = await settleJobWorktree(params.id!, "discard");
        if (!result) throw new HttpError(404, "Задание не найдено");
        json(res, 200, result);
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        if (/Дождитесь|уже занята/.test(message)) throw new HttpError(409, message);
        if (/Проект не найден/.test(message)) throw new HttpError(404, message);
        throw error;
      }
    },
  },
  {
    method: "POST",
    path: "/api/agent/jobs/:id([0-9a-f]{12})/stop",
    handler: async ({ req, res, params }) => {
      pageOnly(req);
      const job = await stopJob(params.id!);
      if (!job) throw new HttpError(404, "Задание не найдено");
      json(res, 200, { job });
    },
  },
  {
    method: "POST",
    path: "/api/agent/jobs/:id([0-9a-f]{12})/answer",
    handler: async ({ req, res, params }) => {
      pageOnly(req);
      const body = await readBody(req);
      const answers = body.answers;
      json(res, 200, {
        job: await answerJob(params.id!, {
          request: asString(body.request) || undefined,
          allow: typeof body.allow === "boolean" ? body.allow : undefined,
          always: typeof body.always === "boolean" ? body.always : undefined,
          text: asString(body.text) || undefined,
          answers:
            answers === null
              ? null
              : answers && typeof answers === "object"
                ? (answers as Record<string, string[]>)
                : undefined,
        }),
      });
    },
  },
];
