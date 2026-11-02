import type { AgentRunOptions } from "../../agent/index.ts";

const text = (value: unknown, limit: number) =>
  typeof value === "string" ? value.slice(0, limit) : "";

/** `cursor/generate_image`: the chat already renders `![alt](path)` from an absolute file. */
export async function showCursorImage(
  options: AgentRunOptions,
  params: Record<string, unknown>,
): Promise<unknown> {
  const path = text(params.filePath, 2000);
  const description = text(params.description, 500) || "изображение";
  if (path) options.emit("text", { text: `\n\n![${description}](${path})\n` });
  const id = text(params.toolCallId, 200) || "generate_image";
  options.emit("tool", { id, name: "generate_image", input: { description, filePath: path } });
  options.emit("tool-result", { id, name: "generate_image", output: path });
  return {};
}
