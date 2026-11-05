/**
 * The chat's own name before the agent names its session: the first message, one line.
 * Matches the name the server saves in the project's chat list (`chatTitle`).
 */
export function chatShortTitle(text: string, limit = 80): string {
  const line = text.replace(/\s+/g, " ").trim();
  if (!line) return "";
  if (line.length <= limit) return line;
  return `${line.slice(0, limit - 1).trimEnd()}…`;
}

/**
 * What a chat's tab says: the native session title once the agent has named it, otherwise the
 * first message, and the agent's label while the chat is empty.
 */
export function chatTabTitle(session: string | undefined, firstMessage: string, fallback: string) {
  const named = session?.replace(/\s+/g, " ").trim();
  return named || chatShortTitle(firstMessage) || fallback;
}
