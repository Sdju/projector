import { getCurrentInstance } from "vue";
import { commandArgs } from "../../../common/utilities/commands.ts";
import {
  answerJob,
  fetchJob,
  fetchJobs,
  jobFinished,
  startJob,
  stopJob,
  type AgentJobView,
} from "../api/jobs.ts";
import { useIdeCommands } from "../../ide/index.ts";
import {
  clientAgentByBackend,
  clientAgentOf,
  clientAgents,
} from "../../agents-integration/catalog/index.ts";
import { useJobTabRequests } from "./job-open.ts";
import type { RegisterCommand } from "./register-command.ts";

/** What a command returns of the answer: enough to judge it, the rest is in the job's tab. */
const RESULT_CHARS = 8000;
const WAIT_LIMIT = 45;

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

const JOB = "Идентификатор задания из ide.agent.jobs.list или ide.agent.job.start";

function text(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== "string" || !value.trim()) throw new Error(`Укажите ${key}`);
  return value.trim();
}

/** A job as the agent sees it: state, requests that wait, files and a bounded answer. */
function describe(job: AgentJobView) {
  const result = job.result ?? job.resultPreview ?? "";
  return {
    job: job.id,
    agent: job.backend,
    status: job.status,
    task: job.task.slice(0, 200),
    ...(job.error ? { error: job.error } : {}),
    waiting: job.pending.map((card) => ({
      request: card.id,
      kind: card.kind,
      title: card.title,
      ...(card.detail ? { detail: card.detail.slice(0, 500) } : {}),
      ...(card.questions
        ? {
            questions: card.questions.map((item) => ({
              question: item.question,
              options: item.options.map((option) => option.label),
            })),
          }
        : {}),
    })),
    files: job.files,
    ...(job.worktree ? { copy: { branch: job.worktree.branch, folder: job.cwd } } : {}),
    result: result.length > RESULT_CHARS ? `${result.slice(0, RESULT_CHARS)}…` : result,
    ...(result.length > RESULT_CHARS ? { resultCut: true } : {}),
  };
}

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
        mode: typeof options.mode === "string" ? options.mode : undefined,
      });
      return describe(job);
    },
    () => true,
    undefined,
    {
      description: `Запускает фонового агента (${agentTitles()}) с заданием в проекте: сервер ведёт его сам, вкладка чата не нужна, прогресс виден в острове активности. Возвращает идентификатор задания. Запросы разрешений и вопросы агента приходят как состояние needs-user и ждут ответа (ide.agent.job.answer). Одновременно работает не больше 4 заданий. С isolate: true агент работает в изолированной git-копии проекта (слияние только по просьбе пользователя). Код пишут фоновые агенты, не вы: поручайте им работу, потом проверяйте результат через ide.agent.job.result и git diff.`,
      arguments: {
        agent: agentIds(),
        task: "Полное задание агенту: цель, файлы, критерии готовности",
        isolate:
          "true — работать в изолированной копии проекта (для независимых задач, которые идут параллельно)",
        mode: "Режим разрешений агента (необязательно; по умолчанию агент спрашивает)",
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
        "Возвращает состояние и итог фонового задания: итоговый ответ агента (до 8000 символов), изменённые файлы, ошибку и запросы, которые ждут ответа. С wait (секунды, до 45) ждёт смены состояния, а не возвращается сразу. Результат агента сверяйте с git diff, а не принимайте на веру.",
      arguments: { job: JOB, wait: "Сколько секунд ждать смены состояния, до 45 (необязательно)" },
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
      return describe(
        await answerJob(text(options, "job"), {
          text: text(options, "answer"),
          request: typeof options.request === "string" ? options.request : undefined,
        }),
      );
    },
    () => true,
    undefined,
    {
      description:
        "Отвечает на запрос фонового задания в состоянии needs-user. На запрос разрешения: allow (разрешить), always (разрешить и запомнить, если агент это умеет) или deny (отклонить). На вопрос агента: текст ответа. Запросы и их идентификаторы видно в ide.agent.job.result. Разрешения решает пользователь: без его слова не разрешайте опасные действия.",
      arguments: {
        job: JOB,
        answer: "allow, always, deny или текст ответа на вопрос",
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
