import { inputHint } from "./tool-input.ts";
import { toolLabel } from "./tool-labels.ts";
import { legacyParts } from "../model/turn-events.ts";
import type { AgentTurn } from "../model/types.ts";

/** The chat as a Markdown document: who said what, with the tool calls between the words. */
export function chatMarkdown(turns: AgentTurn[], title: string): string {
  const out = [`# ${title}`];
  for (const turn of turns) {
    if (turn.role === "user") {
      out.push(`## Вы\n\n${turn.text.trim()}`);
      continue;
    }
    const byId = new Map(turn.tools.map((tool) => [tool.id, tool]));
    const body: string[] = [];
    for (const part of turn.parts ?? legacyParts(turn)) {
      if (part.type === "text") {
        if (part.text.trim()) body.push(part.text.trim());
        continue;
      }
      // Reasoning stays in the chat: the export keeps the answer and what was done.
      if (part.type === "thought") continue;
      if (part.type === "note") {
        body.push(`**Вы добавили:** ${part.text.trim()}`);
        continue;
      }
      const tool = byId.get(part.id);
      if (!tool) continue;
      const hint = inputHint(tool.input ?? "");
      body.push(`> ${toolLabel(tool.name)}${hint ? `: \`${hint.replace(/`/g, "'")}\`` : ""}`);
    }
    out.push(`## ${title.split(" · ")[0] || "Агент"}\n\n${body.join("\n\n")}`);
  }
  return `${out.join("\n\n")}\n`;
}

/** Saves the chat as a Markdown file through the browser. */
export function downloadChatMarkdown(turns: AgentTurn[], title: string, name: string): void {
  const url = URL.createObjectURL(
    new Blob([chatMarkdown(turns, title)], { type: "text/markdown;charset=utf-8" }),
  );
  const link = Object.assign(document.createElement("a"), { href: url, download: name });
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
