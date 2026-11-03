import type { AgentQuestion, AgentRunOptions } from "../../agent/index.ts";
import type { PermissionResult } from "@anthropic-ai/claude-agent-sdk";

const text = (value: unknown, limit: number) =>
  typeof value === "string" ? value.slice(0, limit) : "";

/** Claude Code's `AskUserQuestion` input: a few questions, each with options and a multi-select flag. */
function claudeQuestions(input: Record<string, unknown>): AgentQuestion[] {
  const list = Array.isArray(input.questions) ? input.questions.slice(0, 10) : [];
  return list.flatMap((raw, index) => {
    const item = (raw ?? {}) as Record<string, unknown>;
    const question = text(item.question, 2000);
    if (!question) return [];
    const options = (Array.isArray(item.options) ? item.options.slice(0, 20) : []).flatMap(
      (option, at) => {
        const entry = (option ?? {}) as Record<string, unknown>;
        const label = text(entry.label, 500);
        if (!label) return [];
        const description = text(entry.description, 1000);
        return [{ id: String(at), label, ...(description ? { description } : {}) }];
      },
    );
    const header = text(item.header, 100);
    return [
      {
        id: String(index),
        question,
        ...(header ? { header } : {}),
        options,
        multiple: item.multiSelect === true,
      },
    ];
  });
}

/**
 * Answers Claude Code's `AskUserQuestion`. The tool is not run by the host: the SDK expects the
 * answers back in the input (`answers`, keyed by the question text; several choices joined by
 * ", "), so an allow without them would tell the agent the user answered with nothing.
 */
export async function askClaudeQuestions(
  options: AgentRunOptions,
  input: Record<string, unknown>,
): Promise<PermissionResult> {
  const questions = claudeQuestions(input);
  if (!options.ask || !questions.length)
    return { behavior: "deny", message: "Клиент не может показать вопрос пользователю" };
  const answer = await options.ask({ questions, custom: true }).catch(() => null);
  if (!answer) return { behavior: "deny", message: "Пользователь пропустил вопрос" };
  const answers: Record<string, string> = {};
  for (const question of questions) {
    const chosen = (answer[question.id] ?? [])
      .map((value) => question.options.find((option) => option.id === value)?.label ?? value)
      .filter((value) => value.trim());
    if (chosen.length) answers[question.question] = chosen.join(", ");
  }
  return { behavior: "allow", updatedInput: { ...input, answers } };
}
