import type { MessageChip } from "../../../../agent-core/index.ts";
import type { ReviewComment } from "./review-session.ts";

/** `12` or `12–14`, same en dash as a file chip in chat. */
export function formatLineRange(from: number, to: number) {
  return from === to ? String(from) : `${from}–${to}`;
}

/** `строка 12` or `строки 12–14`. */
export function formatLineLabel(from: number, to: number) {
  return from === to ? `строка ${from}` : `строки ${from}–${to}`;
}

function pluralRu(count: number, one: string, few: string, many: string) {
  const mod100 = Math.abs(count) % 100;
  const mod10 = mod100 % 10;
  if (mod100 > 10 && mod100 < 20) return `${count} ${many}`;
  if (mod10 === 1) return `${count} ${one}`;
  if (mod10 >= 2 && mod10 <= 4) return `${count} ${few}`;
  return `${count} ${many}`;
}

export function formatCommentCount(count: number) {
  return pluralRu(count, "замечание", "замечания", "замечаний");
}

export function formatFileCount(count: number) {
  return pluralRu(count, "файл", "файла", "файлов");
}

/** One user message: path:lines and the remark text, in the order they were written. */
export function formatReviewMessage(comments: readonly ReviewComment[]) {
  if (!comments.length) throw new Error("Нет замечаний");
  const blocks = comments.map(
    (comment) => `${comment.path}:${formatLineRange(comment.from, comment.to)}\n${comment.text}`,
  );
  return `Замечания ревью:\n\n${blocks.join("\n\n")}`;
}

/** File chips the agent can open at the remarked lines. */
export function reviewChips(comments: readonly ReviewComment[]): MessageChip[] {
  return comments.map((comment) => ({
    type: "file",
    path: comment.path,
    range: { from: comment.from, to: comment.to },
  }));
}
