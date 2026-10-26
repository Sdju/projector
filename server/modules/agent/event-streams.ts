import { onEventClientClose } from "../events/index.ts";

/**
 * Answers delivered through a page's events stream, by the page's stream ID: how to detach and
 * whose answer it is. Kept across hot reloads, which leave answers in progress running.
 */
const host = globalThis as typeof globalThis & {
  projectorAgentStreams?: {
    detach: Map<string, () => void>;
    owners: Map<string, string>;
    off?: () => void;
  };
};
const state: NonNullable<typeof host.projectorAgentStreams> = (host.projectorAgentStreams ??= {
  detach: new Map(),
  owners: new Map(),
});
// A page that goes away detaches from its answers like a closed request does.
state.off?.();
state.off = onEventClientClose((client) => {
  for (const [stream, owner] of [...state.owners])
    if (owner === client) state.detach.get(stream)?.();
});

/** Registers an answer of `client`; the returned function forgets it. */
export function trackEventStream(stream: string, client: string, detach: () => void): () => void {
  state.detach.set(stream, detach);
  state.owners.set(stream, client);
  return () => {
    state.detach.delete(stream);
    state.owners.delete(stream);
  };
}

/** The page stopped waiting for the answer. */
export function detachEventStream(stream: string): void {
  state.detach.get(stream)?.();
}
