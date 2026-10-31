import { stat } from "node:fs/promises";
import {
  answerJob,
  clearJobWorktree,
  createWorktree,
  injectMessage,
  isAgentAvailable,
  isAgentBackend,
  isFinished,
  isHostedAgent,
  jobDiff,
  listAgentBackends,
  listJobs,
  mergeWorktree,
  readJob,
  removeJob,
  removeWorktree,
  retryJob,
  selectionFrom,
  startJob,
  stopJob,
  waitForJob,
  worktreeStatus,
} from "../../modules/agent/index.ts";
import { accessAllowed } from "../../modules/access/index.ts";
import { HttpError } from "../../modules/http/index.ts";
import { loadProjects } from "../../modules/projects/index.ts";
import { asString, json, readBody } from "../../modules/transport/index.ts";
import type { RouteContext } from "../../modules/transport/index.ts";

/** The longest task text. */
const TASK_LIMIT = 20_000;
/** The longest wait of a long poll, in seconds. */
const WAIT_LIMIT = 45;

const pageOnly = (req: RouteContext["req"]) => {
  if (!accessAllowed(req, true)) throw new HttpError(403, "Доступно только со страницы Projector");
};

/** A new job from the body of `POST /api/agent/jobs`; everything the client sends is checked here. */
async function startFrom(body: Record<string, unknown>) {
  const backend = asString(body.backend);
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
  const mode = asString(body.mode) || asString(body.permissionMode);
  const selection = selectionFrom(body.selection);
  // Every agent reads the mode its own way: from `permissionMode` or from the selection.
  if (mode) {
    selection.mode = mode;
    selection["permission-mode"] = mode;
  }
  let cwd = project.path;
  let worktree: { id: string; branch: string } | undefined;
  if (body.isolate === true) {
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
      unattended: body.unattended === true,
    });
  } catch (error) {
    if (worktree) await removeWorktree(project.id, worktree.id, project.path).catch(() => {});
    throw error;
  }
}

/** Background agent jobs: start, list, read with the journal, stop, answer and remove. */
export async function handleAgentJobs({
  req,
  res,
  url,
  method,
  path,
}: RouteContext): Promise<boolean> {
  if (path === "/api/agent/jobs" && method === "GET") {
    json(res, 200, { jobs: await listJobs(url.searchParams.get("projectId") || undefined) });
    return true;
  }
  if (path === "/api/agent/jobs" && method === "POST") {
    pageOnly(req);
    json(res, 201, { job: await startFrom(await readBody(req)) });
    return true;
  }
  const match = path.match(
    /^\/api\/agent\/jobs\/([0-9a-f]{12})(?:\/(stop|answer|diff|send|retry|worktree(?:\/(?:merge|discard))?))?$/,
  );
  if (!match) return false;
  const id = match[1]!;
  const action = match[2];
  if (action === "diff" && method === "GET") {
    const found = await readJob(id);
    if (!found) throw new HttpError(404, "Задание не найдено");
    const limit = Number(url.searchParams.get("limit"));
    json(res, 200, {
      diff: await jobDiff(found.job.cwd, limit || undefined, found.job.base, found.job.dirty),
    });
    return true;
  }
  if (action === "send" && method === "POST") {
    pageOnly(req);
    const found = await readJob(id);
    if (!found) throw new HttpError(404, "Задание не найдено");
    if (isFinished(found.job.status)) throw new HttpError(409, "Задание уже завершилось");
    const text = asString((await readBody(req)).text).trim();
    if (!text) throw new HttpError(400, "Напишите уточнение агенту");
    const accepted = await injectMessage(found.job.messageId, text);
    json(res, 200, { accepted });
    return true;
  }
  if (action === "retry" && method === "POST") {
    pageOnly(req);
    const body = await readBody(req);
    const task = asString(body.task).trim() || undefined;
    if (task && task.length > TASK_LIMIT) throw new Error(`Задание длиннее ${TASK_LIMIT} символов`);
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
    return true;
  }
  if (action === "worktree" && method === "GET") {
    const found = await readJob(id);
    if (!found) throw new HttpError(404, "Задание не найдено");
    if (!found.job.worktree) {
      json(res, 200, { worktree: null });
      return true;
    }
    const project = (await loadProjects()).find((item) => item.id === found.job.projectId);
    if (!project) throw new HttpError(404, "Проект не найден");
    json(res, 200, {
      worktree: await worktreeStatus(project.id, found.job.worktree.id, project.path),
    });
    return true;
  }
  if ((action === "worktree/merge" || action === "worktree/discard") && method === "POST") {
    pageOnly(req);
    const found = await readJob(id);
    if (!found) throw new HttpError(404, "Задание не найдено");
    if (!found.job.worktree) throw new HttpError(400, "Задание работает без копии");
    if (!isFinished(found.job.status)) throw new HttpError(409, "Дождитесь завершения задания");
    const project = (await loadProjects()).find((item) => item.id === found.job.projectId);
    if (!project) throw new HttpError(404, "Проект не найден");
    const result = action.endsWith("/merge")
      ? await mergeWorktree(project.id, found.job.worktree.id, project.path)
      : (await removeWorktree(project.id, found.job.worktree.id, project.path),
        { discarded: true });
    json(res, 200, {
      ...result,
      job: await clearJobWorktree(id, project.path),
    });
    return true;
  }
  if (!action && method === "GET") {
    const wait = Math.min(Math.max(Number(url.searchParams.get("wait")) || 0, 0), WAIT_LIMIT);
    const rev = Number(url.searchParams.get("rev"));
    const found =
      wait && Number.isFinite(rev) ? await waitForJob(id, rev, wait) : await readJob(id);
    if (!found) throw new HttpError(404, "Задание не найдено");
    json(res, 200, found);
    return true;
  }
  if (!action && method === "DELETE") {
    pageOnly(req);
    await removeJob(id);
    json(res, 200, { ok: true });
    return true;
  }
  if (action === "stop" && method === "POST") {
    pageOnly(req);
    const job = await stopJob(id);
    if (!job) throw new HttpError(404, "Задание не найдено");
    json(res, 200, { job });
    return true;
  }
  if (action === "answer" && method === "POST") {
    pageOnly(req);
    const body = await readBody(req);
    const answers = body.answers;
    json(res, 200, {
      job: await answerJob(id, {
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
    return true;
  }
  return false;
}
