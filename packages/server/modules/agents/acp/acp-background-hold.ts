import type { AcpTaskPatch } from "./acp-dialect.ts";

/**
 * Tracks background work after `end_turn`. Tasks with `hold: false` do not block the connection
 * (their completion is a later turn) but still mark the process to stay alive after close.
 * `untracked` tasks neither hold nor keep the process.
 */
export function createBackgroundHold() {
  const pending = new Set<string>();
  /** Soft (`hold: false`) ids: keep the process, do not block connection close. */
  const soft = new Set<string>();
  const waiters: Array<() => void> = [];
  const wake = () => {
    if (pending.size) return;
    for (const done of waiters.splice(0)) done();
  };

  return {
    track(patch: AcpTaskPatch) {
      if (
        patch.untracked === true ||
        patch.background === false ||
        patch.status === "done" ||
        patch.status === "error" ||
        patch.status === "stopped"
      ) {
        pending.delete(patch.id);
        soft.delete(patch.id);
        wake();
        return;
      }
      if (patch.background === true && patch.status === "running") {
        if (patch.hold === false) {
          soft.add(patch.id);
          pending.delete(patch.id);
        } else {
          pending.add(patch.id);
          soft.delete(patch.id);
        }
      }
      wake();
    },
    get size() {
      return pending.size;
    },
    /** Connection wait, process keep-alive file, or both. */
    get keepsProcess() {
      return pending.size > 0 || soft.size > 0;
    },
    wait(signal?: AbortSignal, poll?: () => void): Promise<void> {
      if (!pending.size || signal?.aborted) return Promise.resolve();
      return new Promise((resolve) => {
        let timer: ReturnType<typeof setInterval> | undefined;
        const done = () => {
          if (timer !== undefined) clearInterval(timer);
          signal?.removeEventListener("abort", done);
          const index = waiters.indexOf(done);
          if (index >= 0) waiters.splice(index, 1);
          resolve();
        };
        waiters.push(done);
        signal?.addEventListener("abort", done, { once: true });
        if (poll) {
          timer = setInterval(() => {
            try {
              poll();
            } catch {
              /* A poll failure must not drop the wait; the next tick or a notify can still clear. */
            }
          }, 1000);
        }
        if (!pending.size || signal?.aborted) done();
      });
    },
  };
}
