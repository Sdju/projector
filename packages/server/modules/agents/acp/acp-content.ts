interface ContentBlock {
  type?: string;
  text?: string;
}

export function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content))
    return content
      .map((part) => (part as ContentBlock | null)?.text ?? "")
      .filter(Boolean)
      .join("");
  const block = content as ContentBlock | null;
  return typeof block?.text === "string" ? block.text : "";
}

export function toolOutput(update: Record<string, unknown>): string {
  // `content` is what the protocol asks clients to display; `rawOutput` is often only metadata
  // (a status, an exit code), so it is used when the update carries no readable content.
  const content = Array.isArray(update.content) ? update.content : [];
  const text = content
    .map((item) => {
      const block = item as {
        type?: string;
        content?: unknown;
        path?: unknown;
        oldText?: unknown;
        newText?: unknown;
      };
      if (block?.type === "content") return contentText(block.content);
      if (block?.type === "diff")
        return [
          String(block.path ?? ""),
          ...(typeof block.oldText === "string"
            ? block.oldText.split("\n").map((line) => `- ${line}`)
            : []),
          ...(typeof block.newText === "string"
            ? block.newText.split("\n").map((line) => `+ ${line}`)
            : []),
        ].join("\n");
      return "";
    })
    .filter(Boolean)
    .join("\n");
  if (text) return text;
  if (typeof update.rawOutput === "string") return update.rawOutput;
  if (update.rawOutput != null) return JSON.stringify(update.rawOutput, null, 2);
  return "";
}
