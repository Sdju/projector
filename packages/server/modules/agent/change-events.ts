import { broadcastEvent } from "../events/index.ts";

/** A burst of changes is one read: status, waiting cards and the session arrive close together. */
const DELAY_MS = 300;

interface Pending {
  timer?: ReturnType<typeof setTimeout>;
}

// Vite reloads the module without dropping its timers: keep them across reloads.
const host = globalThis as typeof globalThis & {
  projectorAgentChangeEvents?: { jobs?: Pending; runs?: Pending };
};
const state = (host.projectorAgentChangeEvents ??= {});

function schedule(slot: "jobs" | "runs", event: string): void {
  const pending = (state[slot] ??= {});
  if (pending.timer) return;
  pending.timer = setTimeout(() => {
    pending.timer = undefined;
    broadcastEvent(event, { at: Date.now() });
  }, DELAY_MS);
  (pending.timer as { unref?: () => void }).unref?.();
}

/** The list of background jobs changed: pages read it again instead of polling it. */
export function jobsChanged(): void {
  schedule("jobs", "jobs-changed");
}

/** A live agent run started or ended: the activity island reads the list again. */
export function runsChanged(): void {
  schedule("runs", "runs-changed");
}
