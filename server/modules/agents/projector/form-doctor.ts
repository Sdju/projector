import { defaultSettingsMiddleware, generateText, wrapLanguageModel } from "ai";
import {
  createQwenOpenAI,
  envFallbackFromProcess,
  quietThinkingBody,
  resolveOpenAIProvider,
} from "../../providers/index.ts";

/** The doctor gets only the conversation and the broken block; it must not call tools or change files. */
const SYSTEM = `Ты Form Doctor — ремонтируешь Vue-разметку формы Projector. На вход приходят история чата, ошибочная форма и сообщение компилятора.

Верни только исправленную форму одним блоком, без markdown, пояснений, кодового блока и текста после неё. Сохрани корень: <IntelligentForm>…</IntelligentForm> или <Form>…</Form>. Сохрани назначение формы, поля name, options, initial, summary и подписи; меняй только то, что нужно для корректной разметки.

Исправляй повторяющиеся атрибуты, незакрытые и лишние теги, кавычки, неверные имена атрибутов и другие синтаксические ошибки. Внутри <IntelligentForm> не добавляй <Card>, <Form> или <Button submit>: поля должны быть прямыми потомками. Не добавляй <script>, если его не было. Разрешены компоненты IntelligentForm, Form, Card, Checks, Input, Slider, Tabs, Tab, Button, Row, Columns и обычный HTML.`;

export interface FormDoctorRequest {
  form: string;
  error: string;
  history?: string;
  selection?: Record<string, string>;
  signal?: AbortSignal;
}

/** Repairs one form with the same provider/model as the chat; no tools, history or side effects. */
export async function repairForm(request: FormDoctorRequest): Promise<string> {
  const [providerId, ...rest] = (request.selection?.provider || "").split(":");
  const resolved = await resolveOpenAIProvider({
    providerId,
    model: rest.join(":"),
    fallback: envFallbackFromProcess(),
  });
  const provider = createQwenOpenAI({
    openaiUrl: resolved.url,
    openaiApiKey: resolved.apiKey,
  });
  const style = resolved.thinking === false ? "none" : resolved.thinkingStyle;
  const quiet = quietThinkingBody(style);
  const model = quiet
    ? wrapLanguageModel({
        model: provider.chatModel(resolved.model),
        middleware: defaultSettingsMiddleware({
          settings: { providerOptions: { qwenOpenai: quiet } },
        }),
      })
    : provider.chatModel(resolved.model);
  const history = (request.history ?? "").slice(-20_000);
  const form = request.form.slice(0, 30_000);
  const error = request.error.slice(0, 2_000);
  const { text } = await generateText({
    model,
    system: SYSTEM,
    prompt: `История чата (последние сообщения):\n${history || "нет"}\n\nОшибочная форма:\n${form}\n\nОшибка компилятора:\n${error}\n\nВерни исправленную форму.`,
    maxRetries: 0,
    maxOutputTokens: 4_000,
    abortSignal: request.signal,
  });
  const answer = text.trim();
  if (!answer) throw new Error("Form Doctor вернул пустой ответ");
  return answer;
}
