import { generateText } from "ai";
import { serviceRoleSelection } from "../../agent-roles/index.ts";
import { quietChatModel } from "../../providers/index.ts";
import { recordTaskSpend } from "../../spend/index.ts";
import { doctorMessages } from "./doctor-messages.ts";

/** The doctor gets only the conversation and the broken block; it must not call tools or change files. */
const SYSTEM = `Ты Form Doctor — ремонтируешь Vue-разметку формы Projector. На вход приходят история чата, ошибочная форма и сообщение компилятора.

Верни только исправленную форму одним блоком, без markdown, пояснений, кодового блока и текста после неё. Сохрани корень: <IntelligentForm>…</IntelligentForm> или <Form>…</Form>. Сохрани назначение формы, поля name, options, initial, summary и подписи; меняй только то, что нужно для корректной разметки.

Исправляй повторяющиеся атрибуты, незакрытые и лишние теги, кавычки, неверные имена атрибутов и другие синтаксические ошибки. Внутри <IntelligentForm> не добавляй <Card>, <Form> или <Button submit>: поля должны быть прямыми потомками. Не добавляй <script>, если его не было. Разрешены компоненты IntelligentForm, Form, Card, Checks, Input, Slider, Tabs, Tab, Button, Row, Columns и обычный HTML.

Иногда проверка ошибается: например, форма уже корректна, а имя компонента проверке просто неизвестно. Если переписывать нечего, не трогай форму. Верни первой строкой PROJECTOR-DOCTOR: VALID, а со следующей строки — короткую причину (до 300 символов). Больше ничего в ответе быть не должно. Настоящую ошибку компилятора, незакрытый тег или пустую форму не оспаривай — это факт.`;

export interface FormDoctorRequest {
  form: string;
  error: string;
  /** The form before the first repair; defaults to `form`. */
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

/** Repairs one form with the same provider/model as the chat; no tools, history or side effects. */
export async function repairForm(request: FormDoctorRequest): Promise<string> {
  const quiet = await quietChatModel(await serviceRoleSelection("doctor", request.selection));
  const attempt = Math.min(Math.max(Math.trunc(request.attempt ?? 1), 1), 10);
  const limit = Math.min(Math.max(Math.trunc(request.limit ?? 3), attempt), 10);
  const result = await generateText({
    model: quiet.model,
    system: SYSTEM,
    messages: doctorMessages({
      kind: "form",
      original: (request.original ?? request.form).slice(0, 30_000),
      originalError: (request.originalError ?? request.error).slice(0, 2_000),
      error: request.error.slice(0, 2_000),
      history: request.history,
      previous: request.previous?.slice(0, 30_000),
      attempt,
      limit,
    }),
    maxRetries: 0,
    maxOutputTokens: 4_000,
    abortSignal: request.signal,
  });
  recordTaskSpend("doctor-form", result.usage, quiet.price, {
    provider: quiet.provider,
    model: quiet.name,
  });
  const answer = result.text.trim();
  if (!answer) throw new Error("Form Doctor вернул пустой ответ");
  return answer;
}
