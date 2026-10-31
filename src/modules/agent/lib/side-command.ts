/**
 * The question after `/btw`, or `undefined` when the message is not that command. An empty
 * question opens the side panel without asking anything.
 */
export function btwQuestion(text: string): string | undefined {
  const match = /^\/btw(?:\s+([\s\S]*))?$/.exec(text.trim());
  return match ? (match[1] ?? "").trim() : undefined;
}
