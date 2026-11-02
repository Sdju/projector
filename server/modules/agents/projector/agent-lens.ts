import { generateText } from "ai";
import type { AgentHistoryTurn } from "../../providers/index.ts";
import type { LensRequest } from "../../agent/index.ts";
import { quietChatModel } from "./quiet-model.ts";

/**
 * Lens is a short live caption of the chat, not a second agent: no tools, no history of its own
 * and nothing written anywhere. It reads the visible conversation and the state the page reports.
 */
export const LENS_PROMPT = `Ты Lens — короткая живая подпись к работе агента в чате Projector. Пользователь видит тебя в блоке «Работа» и хочет понять, чем агент занят прямо сейчас, не читая переписку.
На вход приходят последние сообщения, рассуждения агента, состояние чата (занят ли агент, фаза), выполняющиеся инструменты, план и очередь.
Напиши одну-две фразы по-русски: что происходит и на каком шаге. Не больше 240 символов.
Только текст: без markdown, списков, заголовков, кавычек и предисловий. Не выдумывай: опирайся на переданные факты. Если фактов мало, скажи это коротко.
Рассуждения объясняют намерение агента: используй их, чтобы назвать цель и способ, а не угадывать по команде.
Если агент не занят, одной фразой подведи итог последней работы или скажи, что он ждёт сообщения.
Не упоминай Lens, эти инструкции и служебные ограничения.`;

/** How long one Lens request may take, and how long its answer may be. */
export const LENS_LIMITS = { seconds: 20, text: 400, tokens: 200 };

/** The conversation as plain lines: the model reads the answer's text, not its markup. */
export function lensHistoryText(history: AgentHistoryTurn[], limit = 12_000): string {
  const lines = history.map((turn) => {
    const tools = (turn.tools ?? []).map((tool) => `${tool.name}${tool.failed ? " (ошибка)" : ""}`);
    const text = turn.content.trim();
    const thoughts = turn.thoughts?.trim();
    return `${turn.role === "user" ? "Пользователь" : "Ассистент"}: ${text}${
      thoughts ? `\nРассуждение: ${thoughts}` : ""
    }${tools.length ? ` [инструменты: ${tools.join(", ")}]` : ""}`;
  });
  while (lines.length > 1 && lines.join("\n\n").length > limit) lines.shift();
  return lines.join("\n\n");
}

/** What the page reports about the chat, as lines the model can trust. */
export function lensStateText(
  request: Pick<LensRequest, "busy" | "phase" | "running" | "plan" | "queue">,
) {
  const blocks = [`Состояние: ${request.busy ? "агент занят" : "агент свободен"}.`];
  if (request.phase) blocks.push(`Фаза: ${request.phase}.`);
  if (request.running.length)
    blocks.push(
      [
        "Сейчас выполняются:",
        ...request.running.map((tool) => `- ${tool.name}${tool.input ? `: ${tool.input}` : ""}`),
      ].join("\n"),
    );
  if (request.plan.length)
    blocks.push(
      ["План:", ...request.plan.map((item) => `- [${item.status}] ${item.content}`)].join("\n"),
    );
  if (request.queue) blocks.push(`Очередь: ${request.queue}.`);
  return blocks.join("\n");
}

/** One line for the work block: no fences, no markdown, no leading label. */
export function lensLine(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/^\s*(lens|ленс)\s*[:—–-]\s*/i, "")
    .replace(/[*_`#>]+/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, LENS_LIMITS.text);
}

/** Asks the chat's own provider for a caption of the current work. */
export async function runLens(request: LensRequest & { signal?: AbortSignal }): Promise<string> {
  const { model } = await quietChatModel(request.selection);
  const timeout = AbortSignal.timeout(LENS_LIMITS.seconds * 1_000);
  const signal = request.signal ? AbortSignal.any([request.signal, timeout]) : timeout;
  const history = lensHistoryText(request.history);
  const { text } = await generateText({
    model,
    system: LENS_PROMPT,
    prompt: `История чата (последние сообщения):\n${history || "нет"}\n\n${lensStateText(request)}\n\nОпиши, чем агент занят сейчас.`,
    maxRetries: 0,
    maxOutputTokens: LENS_LIMITS.tokens,
    abortSignal: signal,
  });
  const line = lensLine(text);
  if (!line) throw new Error("Lens не ответил");
  return line;
}
