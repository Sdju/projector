import type { AgentJobEntry, AgentJobView, JobAnswerBody } from "../api/jobs.ts";

/** How long the result command holds the answer, in seconds. */
export const WAIT_LIMIT = 45;
/** How many tool calls the log returns at most, and how long each of them is. */
export const LOG_LIMIT = 40;
const LOG_TEXT = 1500;

export const JOB = "Идентификатор задания из ide.agent.jobs.list или ide.agent.job.start";

export function text(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== "string" || !value.trim()) throw new Error(`Укажите ${key}`);
  return value.trim();
}

/** A job as the agent sees it: state, requests that wait, files and the answer. */
export function describe(job: AgentJobView) {
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
      ...(card.custom ? { custom: true } : {}),
      ...(card.questions
        ? {
            questions: card.questions.map((item) => ({
              id: item.id,
              question: item.question,
              ...(item.header ? { header: item.header } : {}),
              multiple: item.multiple,
              options: item.options.map((option) => ({
                id: option.id,
                label: option.label,
              })),
            })),
          }
        : {}),
    })),
    files: job.files,
    ...(job.worktree ? { copy: { branch: job.worktree.branch, folder: job.cwd } } : {}),
    result,
    ...(job.result !== undefined ? { resultLength: job.result.length } : {}),
  };
}

/** The answer of the agent to a waiting question: option ids or free text, never a permission. */
export function answerBody(options: Record<string, unknown>): JobAnswerBody {
  const request = typeof options.request === "string" ? options.request : undefined;
  if (typeof options.allow === "boolean" || options.always === true)
    throw new Error("Разрешение подтверждает пользователь карточкой в чате Projector");
  const answers = options.answers;
  if (answers !== undefined) {
    if (answers === null) return { request, answers: null };
    if (typeof answers !== "object" || Array.isArray(answers))
      throw new Error("answers: объект { id вопроса: [id вариантов] }");
    const map: Record<string, string[]> = {};
    for (const [id, value] of Object.entries(answers)) {
      if (!Array.isArray(value) || value.some((item) => typeof item !== "string"))
        throw new Error("answers: значения — массивы идентификаторов вариантов");
      map[id] = value as string[];
    }
    return { request, answers: map };
  }
  const answer = typeof options.answer === "string" ? options.answer.trim() : "";
  if (/^(allow|always|deny)$/i.test(answer))
    throw new Error("Разрешение подтверждает пользователь карточкой в чате Projector");
  if (answer) return { request, text: answer };
  throw new Error("Укажите answers или текст ответа на вопрос");
}

const clipText = (value: unknown, max = LOG_TEXT): { text?: string; cut: boolean } => {
  if (value === undefined) return { cut: false };
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > max ? { text: `${text.slice(0, max)}…`, cut: true } : { text, cut: false };
};

/** The last tool calls of the job with their results: what it ran and what came back. */
export function toolCalls(journal: AgentJobEntry[], tail: number) {
  interface Call {
    at: number;
    id: string;
    name: string;
    input?: unknown;
    output?: unknown;
    resultAt?: number;
  }
  const calls: Call[] = [];
  const byId = new Map<string, Call>();
  for (const entry of journal) {
    const data = entry.data as Record<string, unknown> | undefined;
    if (!data) continue;
    const id = typeof data.id === "string" ? data.id : "";
    if (entry.event === "tool") {
      const call: Call = { at: entry.at, id, name: String(data.name ?? ""), input: data.input };
      calls.push(call);
      if (id) byId.set(id, call);
    } else if (entry.event === "tool-result" && id) {
      const call = byId.get(id);
      if (call) {
        call.output = data.output;
        call.resultAt = entry.at;
      }
    }
  }
  let cut = calls.length > tail;
  const items = calls.slice(-tail).map((call) => {
    const input = clipText(call.input);
    const output = clipText(call.output);
    if (input.cut || output.cut) cut = true;
    return {
      at: call.at,
      ...(call.id ? { id: call.id } : {}),
      name: call.name,
      ...(input.text !== undefined ? { input: input.text } : {}),
      ...(output.text !== undefined ? { output: output.text } : {}),
      ...(call.resultAt ? { resultAt: call.resultAt } : {}),
    };
  });
  return { calls: items, cut };
}

/** Follow-ups the job was given: what it was asked to do after the first answer. */
export function followUps(journal: AgentJobEntry[], tail = 10) {
  const items = journal
    .filter((entry) => entry.event === "input")
    .map((entry) => {
      const data = entry.data as { text?: unknown; followUp?: unknown } | undefined;
      return {
        at: entry.at,
        text: typeof data?.text === "string" ? data.text.slice(0, 2000) : "",
        ...(data?.followUp === true ? { followUp: true } : {}),
      };
    })
    .filter((item) => item.text);
  return { followUps: items.slice(-tail), followUpsCut: items.length > tail };
}
