import { answerFormSource } from "../../widget-runtime/index.ts";
import type { AgentTurn } from "./types.ts";

/** The user message the answer form sends: an optional summary and the values as a JSON block. */
function parseFormReply(
  text: string,
): { summary?: string; values: Record<string, unknown> } | undefined {
  const normalized = text.trim().replace(/\r\n/g, "\n");
  const fence = /```json\n([\s\S]*?)\n```$/.exec(normalized);
  if (!fence) return undefined;
  let values: unknown;
  try {
    values = JSON.parse(fence[1]);
  } catch {
    return undefined;
  }
  if (!values || typeof values !== "object" || Array.isArray(values)) return undefined;
  const summary = normalized.slice(0, fence.index).trim() || undefined;
  return {
    values: values as Record<string, unknown>,
    ...(summary ? { summary } : {}),
  };
}

/** The reply names exactly the fields the form declares, so a random JSON block is not a form. */
function hasFormFields(source: string, values: Record<string, unknown>): boolean {
  const names = new Set([...source.matchAll(/\bname="([^"]+)"/g)].map((match) => match[1]));
  const keys = Object.keys(values);
  return names.size > 0 && keys.every((key) => names.has(key));
}

/**
 * Native agent sessions keep the message text, not the Projector form metadata. Restore the
 * snapshot when a user message is exactly the reply of the preceding answer form.
 */
export function restoreFormAnswers(turns: AgentTurn[]): number {
  let restored = 0;
  for (let index = 1; index < turns.length; index++) {
    const turn = turns[index];
    const previous = turns[index - 1];
    if (turn.role !== "user" || turn.form || previous.role !== "assistant") continue;
    const source = answerFormSource(previous.text);
    if (!source) continue;
    const reply = parseFormReply(turn.text);
    if (!reply || !hasFormFields(source, reply.values)) continue;
    turn.form = {
      source,
      values: reply.values,
      ...(reply.summary ? { summary: reply.summary } : {}),
    };
    restored++;
  }
  return restored;
}
