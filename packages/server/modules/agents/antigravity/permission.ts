import type { AgentRunOptions } from "../../agent/index.ts";

interface PermissionOption {
  optionId?: unknown;
  name?: unknown;
}

const QUESTION_TEXT_LIMIT = 8_000;
const LABEL_LIMIT = 512;

const bounded = (value: string, limit: number): string =>
  value.length <= limit ? value : `${value.slice(0, limit - 3)}...`;

function optionLabel(option: { id: string; name: string }): string {
  return bounded(option.name || option.id, LABEL_LIMIT);
}

/**
 * Antigravity sends fixed-choice user questions over `session/request_permission` with a
 * `toolCallId` starting with `interaction_`. Those are not tool approvals and must be routed
 * through `options.ask` instead of `decidePermission`.
 */
export function handleAntigravityPermission(
  options: AgentRunOptions,
  params: Record<string, unknown>,
): Promise<unknown> | undefined {
  const toolCall =
    params.toolCall && typeof params.toolCall === "object"
      ? (params.toolCall as Record<string, unknown>)
      : {};
  const toolCallId = typeof toolCall.toolCallId === "string" ? toolCall.toolCallId : "";
  if (!toolCallId.startsWith("interaction_")) return undefined;

  return (async () => {
    const rawOptions = Array.isArray(params.options) ? (params.options as PermissionOption[]) : [];
    const seen = new Set<string>();
    const choices: { id: string; name: string }[] = [];
    for (const entry of rawOptions) {
      const id = typeof entry.optionId === "string" ? entry.optionId.trim() : "";
      if (!id || seen.has(id)) return { outcome: { outcome: "cancelled" } };
      seen.add(id);
      const name = typeof entry.name === "string" ? entry.name.trim() : "";
      choices.push({ id, name });
    }
    if (!options.ask || !choices.length) return { outcome: { outcome: "cancelled" } };

    const rawTitle = typeof toolCall.title === "string" ? toolCall.title.trim() : "";
    const questionText = bounded(rawTitle || "Выберите вариант", QUESTION_TEXT_LIMIT);
    const answer = await options
      .ask({
        questions: [
          {
            id: toolCallId,
            question: questionText,
            options: choices.map((choice) => ({ id: choice.id, label: optionLabel(choice) })),
            multiple: false,
            custom: false,
            optional: false,
          },
        ],
        custom: false,
      })
      .catch(() => undefined);
    const picked = answer?.[toolCallId]?.[0];
    if (typeof picked !== "string" || !picked) return { outcome: { outcome: "cancelled" } };

    const exact = choices.find((choice) => choice.id === picked);
    if (exact) return { outcome: { outcome: "selected", optionId: exact.id } };
    const byLabel = choices.filter((choice) => optionLabel(choice) === picked);
    if (byLabel.length === 1) return { outcome: { outcome: "selected", optionId: byLabel[0]!.id } };
    return { outcome: { outcome: "cancelled" } };
  })();
}
