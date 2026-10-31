import { getCurrentInstance } from "vue";
import { commandArgs } from "../../../common/utilities/commands.ts";
import {
  answerJob,
  discardJobWorktree,
  fetchJob,
  fetchJobDiff,
  fetchJobWorktree,
  fetchJobs,
  jobFinished,
  mergeJobWorktree,
  retryJob,
  sendJobMessage,
  startJob,
  stopJob,
} from "../api/jobs.ts";
import { JOB, LOG_LIMIT, WAIT_LIMIT, answerBody, describe, text, toolCalls } from "./job-view.ts";
import { useIdeCommands } from "../../ide/index.ts";
import {
  clientAgentByBackend,
  clientAgentOf,
  clientAgents,
} from "../../agents-integration/catalog/index.ts";
import { chatsOf } from "./chat-registry.ts";
import { isBuiltinAgent } from "./modes.ts";
import { useJobTabRequests } from "./job-open.ts";
import type { RegisterCommand } from "./register-command.ts";

/** External agents the catalog knows: only they can run as background jobs. */
const externalAgents = () => clientAgents().filter((agent) => !agent.builtin);
const agentTitles = () =>
  externalAgents()
    .map((agent) => agent.title)
    .join(", ");
const agentIds = () =>
  externalAgents()
    .map((agent) => agent.backend)
    .join(", ");

/** The commands of background agent jobs for the workspace of a project. */
export function registerJobCommands(
  register: RegisterCommand,
  projectId: string,
  api:
    | {
        executeCommand(id: string, args: unknown, options: { scope: string }): Promise<unknown>;
      }
    | undefined = getCurrentInstance() ? useIdeCommands().api : undefined,
): void {
  // Opens the tab of a job the activity island asked for, once this workspace is up.
  if (getCurrentInstance()) useJobTabRequests(projectId);
  register(
    "ide.agent.job.start",
    "Запустить фонового агента",
    async (args) => {
      const options = commandArgs(args);
      const name = text(options, "agent").toLowerCase();
      const agent = clientAgentByBackend(name) ?? clientAgentOf(name);
      if (!agent || agent.builtin) throw new Error(`agent: ${agentIds()}`);
      const job = await startJob({
        projectId,
        backend: agent.backend,
        task: text(options, "task"),
        isolate: options.isolate === true,
        origin: chatsOf(projectId).find((chat) => isBuiltinAgent(chat.backend))?.key,
      });
      return describe(job);
    },
    () => true,
    undefined,
    {
      description: `Запускает фонового агента (${agentTitles()}) с заданием в проекте: сервер ведёт его сам, вкладка чата не нужна, прогресс виден в острове активности. Возвращает идентификатор задания. Запросы разрешений и вопросы агента приходят как состояние needs-user и ждут ответа (ide.agent.job.answer). С isolate: true агент работает в изолированной git-копии проекта (слияние только по просьбе пользователя). Код пишут фоновые агенты, не вы: поручайте им работу, потом проверяйте результат через ide.agent.job.result и git diff.`,
      arguments: {
        agent: agentIds(),
        task: "Полное задание агенту: цель, файлы, критерии готовности",
        isolate:
          "true — работать в изолированной копии проекта (для независимых задач, которые идут параллельно)",
      },
    },
  );
  register(
    "ide.agent.jobs.list",
    "Фоновые задания агентов",
    async () => (await fetchJobs(projectId)).map(describe),
    () => true,
    undefined,
    {
      description:
        "Возвращает фоновые задания агентов этого проекта, новые первыми: идентификатор, агент, состояние (queued, running, needs-user, done, error, stopped), запросы, которые ждут ответа, изменённые файлы и начало итога.",
    },
  );
  register(
    "ide.agent.job.result",
    "Результат фонового задания",
    async (args) => {
      const options = commandArgs(args);
      const id = text(options, "job");
      const wait = Math.min(Math.max(Number(options.wait) || 0, 0), WAIT_LIMIT);
      let found = await fetchJob(id);
      // Held by the server until the job changes state, so the agent need not poll.
      if (wait && !jobFinished(found.job.status)) found = await fetchJob(id, wait, found.job.rev);
      return describe(found.job);
    },
    () => true,
    undefined,
    {
      description:
        "Возвращает состояние и итог фонового задания целиком, изменённые файлы, ошибку и запросы, которые ждут ответа. С wait (секунды, до 45) ждёт смены состояния, а не возвращается сразу. Результат агента сверяйте с git diff и ide.agent.job.diff, а не принимайте на веру.",
      arguments: { job: JOB, wait: "Сколько секунд ждать смены состояния, до 45 (необязательно)" },
    },
  );
  register(
    "ide.agent.job.diff",
    "Изменения фонового задания",
    async (args) => {
      const options = commandArgs(args);
      const id = text(options, "job");
      const limit = Number(options.limit);
      return { job: id, ...(await fetchJobDiff(id, Number.isFinite(limit) ? limit : 0)) };
    },
    () => true,
    undefined,
    {
      description:
        "Возвращает, что задание изменило в своей папке: список файлов (включая новые), git --stat и unified patch. Для задания в изолированной копии diff берётся из копии. Patch ограничен (по умолчанию 60 000 символов, truncated: true — продолжение в ide.agent.job.open); limit можно увеличить. Это проверка результата, а не повод править файлы самому.",
      arguments: {
        job: JOB,
        limit: "Предел длины patch в символах (необязательно)",
      },
    },
  );
  register(
    "ide.agent.job.log",
    "Вызовы инструментов фонового задания",
    async (args) => {
      const options = commandArgs(args);
      const id = text(options, "job");
      const tail = Math.min(Math.max(Math.trunc(Number(options.tail)) || 20, 1), LOG_LIMIT);
      const found = await fetchJob(id);
      return { job: id, status: found.job.status, ...toolCalls(found.journal, tail) };
    },
    () => true,
    undefined,
    {
      description:
        "Возвращает последние вызовы инструментов задания с их результатами: какие команды проверок запускались и что они ответили. Вывод и вход обрезаны до 1500 символов, cut: true — было больше. Нужен, чтобы судить о работе по фактам, а не по итоговому тексту агента.",
      arguments: {
        job: JOB,
        tail: `Сколько последних вызовов вернуть, до ${LOG_LIMIT} (по умолчанию 20)`,
      },
    },
  );
  register(
    "ide.agent.job.worktree",
    "Копия фонового задания",
    async (args) => {
      const id = text(commandArgs(args), "job");
      return { job: id, worktree: await fetchJobWorktree(id) };
    },
    () => true,
    undefined,
    {
      description:
        "Возвращает изолированную копию задания: ветку и число изменённых файлов; worktree: null — задание работает в папке проекта. Копия есть только у заданий с isolate: true.",
      arguments: { job: JOB },
    },
  );
  register(
    "ide.agent.job.merge",
    "Влить копию задания в проект",
    async (args) => {
      const id = text(commandArgs(args), "job");
      const result = await mergeJobWorktree(id);
      return { job: id, merged: result.merged, message: result.message };
    },
    () => true,
    undefined,
    {
      description:
        "Коммитит изменения задания в его изолированной копии и вливает ветку в проект (git merge), затем удаляет копию. Доступно только завершённому заданию. Меняет файлы и историю git: только по явной просьбе пользователя. При конфликте слияние отменяется, проект остаётся как был.",
      arguments: { job: JOB },
    },
  );
  register(
    "ide.agent.job.discard",
    "Отбросить копию задания",
    async (args) => {
      const id = text(commandArgs(args), "job");
      await discardJobWorktree(id);
      return { job: id, discarded: true };
    },
    () => true,
    undefined,
    {
      description:
        "Удаляет изолированную копию задания и всё, что агент в ней сделал. Необратимо: только по явной просьбе пользователя.",
      arguments: { job: JOB },
    },
  );
  register(
    "ide.agent.job.send",
    "Уточнить идущее задание",
    async (args) => {
      const options = commandArgs(args);
      const id = text(options, "job");
      const sent = await sendJobMessage(id, text(options, "text"));
      if (!sent) throw new Error("Этот агент не принимает уточнения на ходу");
      return { job: id, sent: true };
    },
    () => true,
    undefined,
    {
      description:
        "Добавляет уточнение в ответ, который задание пишет сейчас: агент учтёт его, не останавливаясь. Если агент не поддерживает уточнения на ходу, команда сообщает об этом — задание можно только остановить. Для вопросов, которые ждут ответа, используйте ide.agent.job.answer.",
      arguments: {
        job: JOB,
        text: "Уточнение агенту: что поменять или на что обратить внимание",
      },
    },
  );
  register(
    "ide.agent.job.retry",
    "Повторить фоновое задание",
    async (args) => {
      const options = commandArgs(args);
      const task = typeof options.task === "string" ? options.task : undefined;
      return describe(await retryJob(text(options, "job"), task));
    },
    () => true,
    undefined,
    {
      description:
        "Повторяет завершившееся задание с той же формулировкой, папкой, изолированной копией и нативной сессией: новый ход в той же копии, без создания второй. С task — идёт дальше с новым заданием. Возвращает новое задание.",
      arguments: {
        job: JOB,
        task: "Новая формулировка вместо прежней (необязательно)",
      },
    },
  );
  register(
    "ide.agent.job.continue",
    "Продолжить фоновое задание",
    async (args) => {
      const options = commandArgs(args);
      return describe(await retryJob(text(options, "job"), text(options, "text"), true));
    },
    () => true,
    undefined,
    {
      description:
        "Продолжает завершённое задание новым ходом в той же папке, изолированной копии и нативной сессии: новый текст дописывается как задача. Так изолированное задание продолжается без потери контекста, хотя обычный чат к копии не подключится.",
      arguments: { job: JOB, text: "Что сделать дальше" },
    },
  );
  register(
    "ide.agent.job.stop",
    "Остановить фоновое задание",
    async (args) => describe(await stopJob(text(commandArgs(args), "job"))),
    () => true,
    undefined,
    {
      description: "Останавливает работающее фоновое задание агента. Сделанное остаётся в файлах.",
      arguments: { job: JOB },
    },
  );
  register(
    "ide.agent.job.answer",
    "Ответить фоновому агенту",
    async (args) => {
      const options = commandArgs(args);
      return describe(await answerJob(text(options, "job"), answerBody(options)));
    },
    () => true,
    undefined,
    {
      description:
        "Отвечает на вопрос фонового задания в состоянии needs-user: answers — объект { id вопроса: [id вариантов] } по идентификаторам из waiting, null — пропустить; текст — ответ своими словами. Запросы и их идентификаторы видно в ide.agent.job.result. Разрешения эта команда не подтверждает: их выдаёт пользователь карточкой в чате Projector.",
      arguments: {
        job: JOB,
        answer: "Текст ответа на вопрос",
        answers: "Объект { id вопроса: [id вариантов] }; null — пропустить вопросы",
        request: "Идентификатор запроса из waiting (по умолчанию первый)",
      },
    },
  );
  register(
    "ide.agent.job.open",
    "Открыть фоновое задание во вкладке",
    async (args) => {
      const job = text(commandArgs(args), "job");
      await api?.executeCommand(
        "ide.workbench.agent.job.open",
        { job },
        { scope: `editor:${projectId}` },
      );
      return { job };
    },
    () => true,
    undefined,
    {
      description:
        "Открывает вкладку фонового задания: журнал событий, итог, изменённые файлы, запросы с ответом, остановка и продолжение в чате.",
      arguments: { job: JOB },
    },
  );
}
