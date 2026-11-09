import { onBeforeUnmount, ref, watch, type Ref } from "vue";
import {
  answerJob,
  fetchJob,
  jobFinished,
  stopJob,
  type AgentJobEntry,
  type AgentJobView,
} from "../../../../agent-core/index.ts";

/**
 * Follows a background job with long polling: the first read is immediate, later ones wait for
 * the server to report a change. Actions re-read once so cards disappear without waiting.
 */
export function useJobFollow(jobId: () => string) {
  const job: Ref<AgentJobView | undefined> = ref();
  const journal = ref<AgentJobEntry[]>([]);
  const error = ref("");
  const actionError = ref("");
  const missing = ref(false);
  let alive = true;
  let controller: AbortController | undefined;
  let generation = 0;
  const POLL_GAP_MS = 100;

  function apply(data: { job: AgentJobView; journal: AgentJobEntry[] }): void {
    job.value = data.job;
    journal.value = data.journal;
    error.value = "";
  }

  async function follow(): Promise<void> {
    const mine = ++generation;
    let rev = 0;
    while (alive && mine === generation) {
      controller = new AbortController();
      try {
        const data = await fetchJob(jobId(), rev ? 25 : 0, rev, controller.signal);
        if (!alive || mine !== generation) return;
        apply(data);
        rev = data.job.rev;
        if (jobFinished(data.job.status)) return;
        await new Promise((resolve) => setTimeout(resolve, POLL_GAP_MS));
      } catch (cause) {
        if (!alive || mine !== generation) return;
        const message = cause instanceof Error ? cause.message : "Не удалось прочитать задание";
        if (/не найдено/.test(message)) {
          missing.value = true;
          return;
        }
        error.value = message;
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }
    }
  }

  watch(
    jobId,
    () => {
      generation++;
      controller?.abort();
      void follow();
    },
    { immediate: true },
  );
  onBeforeUnmount(() => {
    alive = false;
    controller?.abort();
  });

  async function act(run: () => Promise<unknown>): Promise<void> {
    actionError.value = "";
    try {
      await run();
      apply(await fetchJob(jobId()));
    } catch (cause) {
      actionError.value = cause instanceof Error ? cause.message : "Не удалось выполнить действие";
    }
  }

  const stop = () => act(() => stopJob(jobId()));
  const decide = (id: string, allow: boolean, always = false) =>
    act(() => answerJob(jobId(), { request: id, allow, always }));
  const answer = (id: string, answers: Record<string, string[]> | null) =>
    act(() => answerJob(jobId(), { request: id, answers }));

  return { job, journal, error, actionError, missing, act, stop, decide, answer };
}
