import { generateText } from "ai";
import { serviceRoleSelection } from "../../agent-roles/index.ts";
import { quietChatModel } from "../../providers/index.ts";
import { recordTaskSpend } from "../../spend/index.ts";
import { doctorMessages } from "./doctor-messages.ts";

const SYSTEM = `Ты Answer Doctor — ремонтируешь только сломанную разметку готового ответа Projector. На вход приходят история чата, ответ и диагностика клиента.

Верни весь исправленный ответ без пояснений и внешнего кодового блока. Сохрани содержание, язык, смысл, порядок и все работающие Vue-виджеты; не добавляй новых фактов и не сокращай ответ.

Чаще всего Markdown ошибочно оказался внутри Vue-виджета: там ###, **, списки, таблицы и обратные кавычки видны как сырой текст. Замени такой Markdown на обычный HTML внутри виджета (h3, p, ul, li, strong, code, table) либо вынеси его за пределы виджета, если это логично по структуре. Не оборачивай весь ответ в виджет. Также исправляй ошибки Vue-разметки, незакрытые теги и неизвестные компоненты, если они указаны в диагностике.

Иногда проверка ошибается: например, принимает математическую запись вроде 7**3**2 или 7 * 3 * 2 за Markdown. Если разметка уже корректна и переписывать нечего, не трогай ответ. Верни первой строкой PROJECTOR-DOCTOR: VALID, а со следующей строки — короткую причину (до 300 символов) с названием места. Больше ничего в ответе быть не должно. Так можно оспорить только эвристику; настоящую ошибку компилятора, незакрытый тег или пустой виджет не оспаривай — это факт.`;

export interface AnswerDoctorRequest {
  answer: string;
  error: string;
  /** The text before the first repair; defaults to `answer`. */
  original?: string;
  /** The diagnosis that opened the round; defaults to `error`. */
  originalError?: string;
  /** The doctor's previous reply: the same round continues from it. */
  previous?: string;
  /** 1-based attempt of the round. */
  attempt?: number;
  /** How many attempts the round allows. */
  limit?: number;
  history?: string;
  selection?: Record<string, string>;
  signal?: AbortSignal;
}

/** Repairs presentation only; the doctor has no tools and cannot change the conversation or files. */
export async function repairAnswer(request: AnswerDoctorRequest): Promise<string> {
  const quiet = await quietChatModel(await serviceRoleSelection("doctor", request.selection));
  const attempt = Math.min(Math.max(Math.trunc(request.attempt ?? 1), 1), 10);
  const limit = Math.min(Math.max(Math.trunc(request.limit ?? 3), attempt), 10);
  const result = await generateText({
    model: quiet.model,
    system: SYSTEM,
    messages: doctorMessages({
      kind: "answer",
      original: (request.original ?? request.answer).slice(0, 60_000),
      originalError: (request.originalError ?? request.error).slice(0, 2_000),
      error: request.error.slice(0, 2_000),
      history: request.history,
      previous: request.previous?.slice(0, 60_000),
      attempt,
      limit,
    }),
    maxRetries: 0,
    maxOutputTokens: 12_000,
    abortSignal: request.signal,
  });
  recordTaskSpend("doctor-answer", result.usage, quiet.price, {
    provider: quiet.provider,
    model: quiet.name,
  });
  const repaired = result.text.trim();
  if (!repaired) throw new Error("Answer Doctor вернул пустой ответ");
  return repaired;
}
