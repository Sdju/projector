import { getCurrentScope, onScopeDispose, ref, shallowRef } from "vue";
import {
  fetchJobs,
  fetchLiveRuns,
  type AgentJobView,
  type LiveAgentRun,
} from "../../../../agent-core/index.ts";

/** The server pushes changes over the page event stream; the timer only repairs a lost stream. */
const FALLBACK_MS = 60_000;
/** A burst of changes is one read: every subscriber of the page shares the same lists. */
const GAP_MS = 300;

export const feedJobs = shallowRef<AgentJobView[]>([]);
export const feedRuns = shallowRef<LiveAgentRun[]>([]);
export const feedError = ref("");
export const feedLoading = ref(true);
export const feedUpdatedAt = ref(0);

export interface JobsFeedUpdate {
  jobs: AgentJobView[];
  runs: LiveAgentRun[];
}

type Listener = (update: JobsFeedUpdate) => void;

const listeners = new Set<Listener>();
let subscribers = 0;
let refreshing: Promise<void> | undefined;
let queued = false;
let scheduled: ReturnType<typeof setTimeout> | undefined;
let fallback: ReturnType<typeof setInterval> | undefined;
let stopTransport: (() => void) | undefined;
let lastReadAt = 0;

function emit(): void {
  const update = { jobs: feedJobs.value, runs: feedRuns.value };
  for (const listener of Array.from(listeners)) listener(update);
}

async function read(): Promise<void> {
  if (refreshing) {
    queued = true;
    return refreshing;
  }
  refreshing = (async () => {
    try {
      const [jobList, runList] = await Promise.allSettled([fetchJobs(), fetchLiveRuns()]);
      if (!subscribers) return;
      const failure =
        jobList.status === "rejected"
          ? jobList.reason
          : runList.status === "rejected"
            ? runList.reason
            : undefined;
      if (jobList.status === "fulfilled") feedJobs.value = jobList.value;
      if (runList.status === "fulfilled") feedRuns.value = runList.value;
      feedError.value = failure
        ? failure instanceof Error
          ? failure.message
          : "Не удалось прочитать работы"
        : "";
      if (!failure) feedUpdatedAt.value = Date.now();
      emit();
    } finally {
      if (subscribers) {
        feedLoading.value = false;
        lastReadAt = Date.now();
      }
      refreshing = undefined;
    }
  })();
  await refreshing;
  if (queued) {
    queued = false;
    schedule(0);
  }
}

/** One read for a burst; a page that just read waits out the gap before the next one. */
function schedule(delay = GAP_MS, force = false): void {
  if (!subscribers) return;
  if (scheduled !== undefined) {
    if (!force) return;
    clearTimeout(scheduled);
    scheduled = undefined;
  }
  const wait = force ? 0 : Math.max(delay, lastReadAt + GAP_MS - Date.now(), 0);
  scheduled = setTimeout(() => {
    scheduled = undefined;
    void read();
  }, wait);
}

function stopFeed(): void {
  stopTransport?.();
  stopTransport = undefined;
  if (scheduled !== undefined) clearTimeout(scheduled);
  scheduled = undefined;
  if (fallback !== undefined) clearInterval(fallback);
  fallback = undefined;
  listeners.clear();
  feedJobs.value = [];
  feedRuns.value = [];
  feedError.value = "";
  feedUpdatedAt.value = 0;
  feedLoading.value = true;
  lastReadAt = 0;
  queued = false;
}

function startFeed(): void {
  const push = () => schedule();
  const resync = () => schedule(0, true);
  const visible = () => {
    if (document.visibilityState === "visible") schedule(0, true);
  };
  if (typeof window !== "undefined") {
    window.addEventListener("projector:jobs-changed", push);
    window.addEventListener("projector:runs-changed", push);
    window.addEventListener("projector:events-open", resync);
  }
  if (typeof document !== "undefined") document.addEventListener("visibilitychange", visible);
  fallback = setInterval(() => void read(), FALLBACK_MS);
  (fallback as { unref?: () => void }).unref?.();
  stopTransport = () => {
    if (typeof window !== "undefined") {
      window.removeEventListener("projector:jobs-changed", push);
      window.removeEventListener("projector:runs-changed", push);
      window.removeEventListener("projector:events-open", resync);
    }
    if (typeof document !== "undefined") document.removeEventListener("visibilitychange", visible);
  };
  void read();
}

/**
 * The background jobs and live runs of this server, shared by the inbox, the island and every
 * open chat. The server sends `jobs-changed` and `runs-changed` over the page event stream, so an
 * idle page does not poll; the timer is a fallback for a stream that dropped a change.
 */
export function useJobsFeed() {
  if (!subscribers) startFeed();
  subscribers++;
  if (getCurrentScope())
    onScopeDispose(() => {
      subscribers = Math.max(0, subscribers - 1);
      if (!subscribers) stopFeed();
    });
  return {
    jobs: feedJobs,
    runs: feedRuns,
    error: feedError,
    loading: feedLoading,
    updatedAt: feedUpdatedAt,
    refresh: () => read(),
    onUpdate: onJobsFeedUpdate,
  };
}

/** Calls the listener after every read; a listener joining a loaded feed gets the state at once. */
export function onJobsFeedUpdate(listener: Listener): () => void {
  listeners.add(listener);
  if (!feedLoading.value) listener({ jobs: feedJobs.value, runs: feedRuns.value });
  return () => listeners.delete(listener);
}

import.meta.hot?.dispose(() => {
  subscribers = 0;
  stopFeed();
});
