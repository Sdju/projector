import type { MessageChip, MessagePart } from "../model/types.ts";

/** The text a chip stands for when the message is read as plain text (history, text-only agents). */
export function chipText(chip: MessageChip): string {
  if (chip.type === "file") {
    const path = chip.directory && !chip.path.endsWith("/") ? `${chip.path}/` : chip.path;
    return /\s/.test(path) ? `@"${path}"` : `@${path}`;
  }
  if (chip.type === "command") return `/${chip.name}`;
  return `[${chip.name}]`;
}

export function messageText(parts: readonly MessagePart[]): string {
  return parts.map((part) => (part.type === "text" ? part.text : chipText(part))).join("");
}

/** Merges neighbouring text and drops empty text, so equal messages have equal parts. */
export function normalizeParts(parts: readonly MessagePart[]): MessagePart[] {
  const result: MessagePart[] = [];
  for (const part of parts) {
    if (part.type !== "text") result.push(part);
    else if (part.text) {
      const last = result.at(-1);
      if (last?.type === "text")
        result[result.length - 1] = { type: "text", text: last.text + part.text };
      else result.push(part);
    }
  }
  return result;
}

export const hasChips = (parts: readonly MessagePart[] | undefined): boolean =>
  !!parts?.some((part) => part.type !== "text");
