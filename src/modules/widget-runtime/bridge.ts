import { inject, type InjectionKey } from "vue";

/** How a component talks back to the agent: it sends a message into the chat the component is in. */
export type WidgetReply = (text: string) => void;
export const widgetReplyKey: InjectionKey<WidgetReply> = Symbol("agent-widget-reply");

/** The user message a component's `reply(data, summary)` becomes: a short line and the data as JSON. */
export function formatWidgetReply(data: unknown, summary?: string): string {
  const json = typeof data === "string" ? data : JSON.stringify(data, null, 2);
  const body = typeof data === "string" ? data : `\`\`\`json\n${json}\n\`\`\``;
  return summary ? `${summary}\n\n${body}` : body;
}

/** True while the user's click (or key press) is fresh; browsers without the API do not block. */
export function userIsActive(): boolean {
  return typeof navigator === "undefined" || navigator.userActivation?.isActive !== false;
}

/**
 * A reply that only goes out on the user's own click: a timer, a watcher or the model's script
 * cannot message the agent on their behalf. Returns whether the message was sent.
 */
export function useWidgetReply(): (data: unknown, summary?: string) => boolean {
  const send = inject(widgetReplyKey, undefined);
  return (data, summary) => {
    if (!send || !userIsActive()) return false;
    send(formatWidgetReply(data, summary));
    return true;
  };
}
