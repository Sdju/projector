import type { InjectionKey } from "vue";

/** How a component talks back to the agent: it sends a message into the chat the component is in. */
export type WidgetReply = (text: string) => void;
export const widgetReplyKey: InjectionKey<WidgetReply> = Symbol("agent-widget-reply");

/** The user message a component's `reply(data, summary)` becomes: a short line and the data as JSON. */
export function formatWidgetReply(data: unknown, summary?: string): string {
  const json = typeof data === "string" ? data : JSON.stringify(data, null, 2);
  const body = typeof data === "string" ? data : `\`\`\`json\n${json}\n\`\`\``;
  return summary ? `${summary}\n\n${body}` : body;
}
