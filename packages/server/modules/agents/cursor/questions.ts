const text = (value: unknown, limit: number) =>
  typeof value === "string" ? value.slice(0, limit) : "";

/** Cursor's `cursor/ask_question` (ACP extension): the answer lists the chosen option IDs. */
export async function askCursorQuestions(
  options: AgentRunOptions,
  params: Record<string, unknown>,
): Promise<unknown> {
  const list = Array.isArray(params.questions) ? params.questions.slice(0, 10) : [];
  const questions: AgentQuestion[] = list.flatMap((raw) => {
    const item = (raw ?? {}) as Record<string, unknown>;
    const id = text(item.id, 200);
    const question = text(item.prompt, 2000);
    if (!id || !question) return [];
    const choices = (Array.isArray(item.options) ? item.options.slice(0, 20) : []).flatMap(
      (option) => {
        const entry = (option ?? {}) as Record<string, unknown>;
        const optionId = text(entry.id, 200);
        return optionId ? [{ id: optionId, label: text(entry.label, 500) || optionId }] : [];
      },
    );
    return [{ id, question, options: choices, multiple: item.allowMultiple === true }];
  });
  if (!options.ask || !questions.length) return { outcome: { outcome: "cancelled" } };
  const title = text(params.title, 300);
  const answer = await options
    .ask({ ...(title ? { title } : {}), questions, custom: false })
    .catch(() => undefined);
  if (answer === undefined) return { outcome: { outcome: "cancelled" } };
  if (answer === null)
    return { outcome: { outcome: "skipped", reason: "Пользователь пропустил вопрос" } };
  return {
    outcome: {
      outcome: "answered",
      answers: questions.map((question) => ({
        questionId: question.id,
        selectedOptionIds: (answer[question.id] ?? []).filter((value) =>
          question.options.some((option) => option.id === value),
        ),
      })),
    },
  };
}
import type { AgentQuestion, AgentRunOptions } from "../../agent/index.ts";
