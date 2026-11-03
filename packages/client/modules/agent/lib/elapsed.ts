import { getCurrentScope, onScopeDispose, ref, type Ref } from "vue";

/**
 * A duration as a ticking label: seconds while short, then minutes and hours.
 * `4 с`, `1:05`, `1:02:05`.
 */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  if (total < 60) return `${total} с`;
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  if (minutes < 60) return `${minutes}:${String(seconds).padStart(2, "0")}`;
  const hours = Math.floor(minutes / 60);
  return `${hours}:${String(minutes % 60).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

/** The shared clock of every elapsed label on the page: one interval, however many labels. */
const now = ref(Date.now());
let timer: ReturnType<typeof setInterval> | undefined;
let users = 0;

export function useElapsedClock(): Readonly<Ref<number>> {
  users++;
  now.value = Date.now();
  timer ??= setInterval(() => {
    now.value = Date.now();
  }, 1000);
  if (getCurrentScope())
    onScopeDispose(() => {
      users--;
      if (!users && timer !== undefined) {
        clearInterval(timer);
        timer = undefined;
      }
    });
  return now;
}

import.meta.hot?.dispose(() => {
  if (timer !== undefined) clearInterval(timer);
  timer = undefined;
  users = 0;
});
