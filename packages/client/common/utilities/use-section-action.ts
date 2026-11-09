import { ref, type Ref } from "vue";

export interface SectionActionOptions<T> {
  errorFallback: string;
  /** Text shown on success; a function receives the task result. */
  success?: string | ((value: T) => string);
  /** Restores the previous value when the task fails. */
  rollback?: () => void;
}

/**
 * Lifecycle of a settings section: initial load with `ready`, and an action with `busy`,
 * `error`, `status` and optional rollback. Sections keep their own fields and requests.
 */
export function useSectionAction(
  shared: { busy?: Ref<boolean>; error?: Ref<string>; status?: Ref<string> } = {},
) {
  const ready = ref(false);
  const busy = shared.busy ?? ref(false);
  const error = shared.error ?? ref("");
  const status = shared.status ?? ref("");

  async function load(task: () => Promise<void>, errorFallback: string): Promise<boolean> {
    error.value = "";
    busy.value = true;
    try {
      await task();
      ready.value = true;
      return true;
    } catch (err) {
      error.value = err instanceof Error ? err.message : errorFallback;
      return false;
    } finally {
      busy.value = false;
    }
  }

  async function perform<T>(
    task: () => Promise<T>,
    options: SectionActionOptions<T>,
  ): Promise<T | undefined> {
    busy.value = true;
    error.value = "";
    status.value = "";
    try {
      const value = await task();
      status.value =
        typeof options.success === "function"
          ? options.success(value)
          : (options.success ?? (typeof value === "string" ? value : ""));
      return value;
    } catch (err) {
      options.rollback?.();
      error.value = err instanceof Error ? err.message : options.errorFallback;
      return undefined;
    } finally {
      busy.value = false;
    }
  }

  /** Shortcut for actions without a custom success text or rollback. */
  function run<T>(task: () => Promise<T>): Promise<T | undefined> {
    return perform(task, { errorFallback: "Не удалось выполнить" });
  }

  return { ready, busy, error, status, load, perform, run };
}
