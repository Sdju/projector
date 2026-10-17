import { readAttachment } from "../../agent/index.ts";
import type { MessagePart } from "../../agent/index.ts";
import type { ModelMessage } from "ai";
import type { AgentHistoryTurn } from "../../providers/index.ts";

/** Roughly what earlier turns may take of the model's context; older whole turns are dropped. */
const HISTORY_CHARS = 90_000;
const OUTPUT_CHARS = 4_000;

function json(text: string | undefined): unknown {
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return {};
  }
}

function weight(turn: AgentHistoryTurn): number {
  return (
    turn.content.length +
    (turn.tools ?? []).reduce((sum, tool) => sum + (tool.input?.length ?? 0) + OUTPUT_CHARS / 2, 0)
  );
}

/** The newest turns that fit, starting at a user message so no answer loses its question. */
export function recentTurns(history: AgentHistoryTurn[]): AgentHistoryTurn[] {
  let budget = HISTORY_CHARS;
  let start = history.length;
  while (start > 0 && budget - weight(history[start - 1]!) >= 0) {
    start--;
    budget -= weight(history[start]!);
  }
  while (start < history.length && history[start]!.role !== "user") start++;
  return history.slice(start);
}

/** Earlier turns as model messages, with the calls an answer made and what they returned. */
export function historyMessages(history: AgentHistoryTurn[]): ModelMessage[] {
  return recentTurns(history).flatMap((turn): ModelMessage[] => {
    if (turn.role === "user") return [{ role: "user", content: turn.content }];
    const tools = turn.tools ?? [];
    if (!tools.length) return [{ role: "assistant", content: turn.content }];
    return [
      {
        role: "assistant",
        content: [
          ...(turn.content ? [{ type: "text" as const, text: turn.content }] : []),
          ...tools.map((tool) => ({
            type: "tool-call" as const,
            toolCallId: tool.id,
            toolName: tool.name,
            input: json(tool.input),
          })),
        ],
      },
      {
        role: "tool",
        content: tools.map((tool) => ({
          type: "tool-result" as const,
          toolCallId: tool.id,
          toolName: tool.name,
          output: {
            type: tool.failed ? ("error-text" as const) : ("text" as const),
            value: tool.output.slice(0, OUTPUT_CHARS) || "(пусто)",
          },
        })),
      },
    ];
  });
}

/** The user's message; pasted images go to the model as pictures. */
export async function userMessage(text: string, parts?: MessagePart[]): Promise<ModelMessage> {
  const images = (parts ?? []).filter((part) => part.type === "image");
  const loaded = await Promise.all(
    images.map(async (part) => ({ part, file: await readAttachment(part.id) })),
  );
  const found = loaded.flatMap((item) => (item.file ? [item.file] : []));
  if (!found.length) return { role: "user", content: text };
  return {
    role: "user",
    content: [
      { type: "text", text },
      ...found.map((file) => ({
        type: "image" as const,
        image: file.content,
        mediaType: file.mime,
      })),
    ],
  };
}
