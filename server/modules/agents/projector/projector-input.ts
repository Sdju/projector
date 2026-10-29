import { registerInjector, type AgentRunOptions } from "../../agent/index.ts";

/** User additions wait for a model boundary, leaving running tools and their results intact. */
export function createTurnInput(options: AgentRunOptions) {
  const pending: { text: string; id?: string; resolve: (accepted: boolean) => void }[] = [];
  const deliveries = new Map<string, { text: string; accepted: Promise<boolean> }>();
  let closed = false;
  const unregister = options.messageId
    ? registerInjector(options.messageId, (text, id) => {
        const earlier = id ? deliveries.get(id) : undefined;
        if (earlier) return earlier.text === text ? earlier.accepted : false;
        if (closed || options.abort?.aborted) return false;
        const accepted = new Promise<boolean>((resolve) => pending.push({ text, id, resolve }));
        if (id) deliveries.set(id, { text, accepted });
        return accepted;
      })
    : undefined;
  return {
    get pending() {
      return pending.length > 0;
    },
    take() {
      if (options.abort?.aborted) return [];
      return pending.splice(0).map(({ text, id, resolve }) => {
        options.emit("input", { text, ...(id ? { inputId: id } : {}) });
        resolve(true);
        return { role: "user" as const, content: text };
      });
    },
    close() {
      closed = true;
      unregister?.();
      for (const item of pending.splice(0)) item.resolve(false);
    },
  };
}
