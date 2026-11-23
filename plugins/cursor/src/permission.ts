/** Cursor keeps the shell command in the backtick-wrapped ACP title. */
export function cursorShellCommand(toolCall: Record<string, unknown>): string {
  const title = typeof toolCall.title === "string" ? toolCall.title.trim() : "";
  if (title.length < 3 || !title.startsWith("`") || !title.endsWith("`")) return "";
  return title.slice(1, -1).trim();
}
