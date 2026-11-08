import { generateText } from "ai";
import { serviceRoleSelection } from "../../agent-roles/index.ts";
import { quietChatModel } from "../../providers/index.ts";

const SYSTEM = `Ты Answer Doctor — ремонтируешь только сломанную разметку готового ответа Projector. На вход приходят история чата, ответ и диагностика клиента.

Верни весь исправленный ответ без пояснений и внешнего кодового блока. Сохрани содержание, язык, смысл, порядок и все работающие Vue-виджеты; не добавляй новых фактов и не сокращай ответ.

Чаще всего Markdown ошибочно оказался внутри Vue-виджета: там ###, **, списки, таблицы и обратные кавычки видны как сырой текст. Замени такой Markdown на обычный HTML внутри виджета (h3, p, ul, li, strong, code, table) либо вынеси его за пределы виджета, если это логично по структуре. Не оборачивай весь ответ в виджет. Также исправляй ошибки Vue-разметки, незакрытые теги и неизвестные компоненты, если они указаны в диагностике.`;

export interface AnswerDoctorRequest {
  answer: string;
  error: string;
  history?: string;
  selection?: Record<string, string>;
  signal?: AbortSignal;
}

/** Repairs presentation only; the doctor has no tools and cannot change the conversation or files. */
export async function repairAnswer(request: AnswerDoctorRequest): Promise<string> {
  const { model } = await quietChatModel(await serviceRoleSelection("doctor", request.selection));
  const history = (request.history ?? "").slice(-20_000);
  const answer = request.answer.slice(0, 60_000);
  const error = request.error.slice(0, 2_000);
  const { text } = await generateText({
    model,
    system: SYSTEM,
    prompt: `История чата (последние сообщения):\n${history || "нет"}\n\nСломанный ответ:\n${answer}\n\nДиагностика:\n${error}\n\nВерни весь исправленный ответ.`,
    maxRetries: 0,
    maxOutputTokens: 12_000,
    abortSignal: request.signal,
  });
  const repaired = text.trim();
  if (!repaired) throw new Error("Answer Doctor вернул пустой ответ");
  return repaired;
}
