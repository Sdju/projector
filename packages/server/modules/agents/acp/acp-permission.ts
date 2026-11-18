import type { AgentRunOptions } from "../../agent/index.ts";
import { contentText } from "./acp-events.ts";

interface PermissionOption {
  optionId?: string;
  kind?: string;
}

/** Longest readable preview sent with a permission request. */
const DETAIL_LIMIT = 8000;

/**
 * A readable preview of what the tool will change. ACP carries edits and MCP arguments in
 * `toolCall.content` (`diff`/`content` blocks), which the raw input does not show.
 */
export function toolCallDetail(toolCall: Record<string, unknown>): string | undefined {
  const content = Array.isArray(toolCall.content) ? toolCall.content : [];
  const parts = content
    .map((item) => {
      const block = item as {
        type?: string;
        content?: unknown;
        path?: string;
        oldText?: string | null;
        newText?: string | null;
      };
      if (block.type === "diff") return diffText(block);
      if (block.type === "content") return contentText(block.content);
      return "";
    })
    .filter(Boolean);
  if (!parts.length) return undefined;
  return parts.join("\n\n").slice(0, DETAIL_LIMIT);
}

function diffText(block: {
  path?: string;
  oldText?: string | null;
  newText?: string | null;
}): string {
  const path = block.path ?? "файл";
  const removed = String(block.oldText ?? "")
    .split("\n")
    .map((line) => `-${line}`);
  const added = String(block.newText ?? "")
    .split("\n")
    .map((line) => `+${line}`);
  return [`--- ${path}`, `+++ ${path}`, ...removed, ...added].join("\n");
}

/** Prefer one-time allow/reject; `allow_always` only when the user chose "always". */
export async function decidePermission(
  options: AgentRunOptions,
  params: Record<string, unknown>,
): Promise<unknown> {
  const toolCall = (params.toolCall ?? {}) as Record<string, unknown>;
  const list = Array.isArray(params.options) ? (params.options as PermissionOption[]) : [];
  const allowOnce = list.find((item) => item.kind === "allow_once");
  const allowAlways = list.find((item) => item.kind === "allow_always");
  const allow = allowOnce ?? allowAlways;
  if (!options.approve || !allow) return { outcome: { outcome: "cancelled" } };
  const kind = String(toolCall.kind ?? "").toLowerCase();
  // The ACP title of a shell call is the command itself. Using it as the tool name repeats the
  // same line three times in the card (title, tool label and preview), so keep the kind instead.
  const tool = kind === "execute" ? "bash" : kind === "edit" ? "edit" : kind || "tool";
  const input = (toolCall.rawInput ?? {}) as Record<string, unknown>;
  const command = typeof input.command === "string" ? input.command : "";
  const title =
    kind === "execute"
      ? "Выполнить команду в оболочке"
      : typeof toolCall.title === "string"
        ? toolCall.title
        : undefined;
  const answer = await options
    .approve({
      tool,
      input,
      ...(title ? { title } : {}),
      detail: toolCallDetail(toolCall) ?? (command ? `$ ${command}` : undefined),
      persistent: !!allowAlways,
    })
    .catch(() => false);
  if (answer === false) {
    const reject =
      list.find((item) => item.kind === "reject_once") ??
      list.find((item) => item.kind === "reject_always");
    if (!reject?.optionId) return { outcome: { outcome: "cancelled" } };
    return { outcome: { outcome: "selected", optionId: reject.optionId } };
  }
  const chosen = answer === "always" ? (allowAlways ?? allowOnce) : (allowOnce ?? allowAlways);
  if (!chosen?.optionId) return { outcome: { outcome: "cancelled" } };
  return { outcome: { outcome: "selected", optionId: chosen.optionId } };
}
