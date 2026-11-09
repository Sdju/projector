import { computed, getCurrentScope, onScopeDispose, ref, watch, type ComputedRef } from "vue";
import { fetchSessions } from "../../../../agent-core/index.ts";
import { jobTitleOf } from "../lib/job-name.ts";
import type { AgentJobView } from "../../../../agent-core/index.ts";
import type { AgentBackendId } from "../../../../agent-core/index.ts";

const TTL_MS = 30_000;
const RETRY_MS = 5_000;
const RETRY_LIMIT = 6;

export interface SessionTitles {
  at: number;
  titles: Map<string, string>;
}

const cache = new Map<string, SessionTitles>();
const pending = new Map<string, Promise<SessionTitles>>();
/** Bumped when a session list arrives, so every open list reads the new titles. */
const version = ref(0);

const cacheKey = (backend: AgentBackendId, projectId: string) => `${backend}:${projectId}`;

/** Titles of the agent's sessions in the project, fetched at most once per half a minute. */
export function loadSessionTitles(
  backend: AgentBackendId,
  projectId: string,
  force = false,
): Promise<SessionTitles> {
  const key = cacheKey(backend, projectId);
  const known = cache.get(key);
  if (!force && known && Date.now() - known.at < TTL_MS) return Promise.resolve(known);
  const inFlight = pending.get(key);
  if (inFlight) return inFlight;
  const request = fetchSessions(backend, projectId)
    .then((sessions) => {
      const entry: SessionTitles = {
        at: Date.now(),
        titles: new Map(sessions.map((session) => [session.id, session.title])),
      };
      cache.set(key, entry);
      version.value++;
      return entry;
    })
    .catch(() => known ?? { at: Date.now(), titles: new Map<string, string>() })
    .finally(() => pending.delete(key));
  pending.set(key, request);
  return request;
}

/** The sessions of a job live in the project; an isolated copy has its own folder and no title. */
const named = (job: AgentJobView) => !!job.sessionId && !job.worktree;

/**
 * A name for a finished job in the chat's continuation note. The agent names its session while
 * it works, so the session list is read again when the cached copy has no title yet.
 */
export async function resolveJobTitle(job: AgentJobView): Promise<string> {
  if (!named(job)) return jobTitleOf(job);
  let entry = await loadSessionTitles(job.backend, job.projectId);
  if (!entry.titles.get(job.sessionId!)?.trim())
    entry = await loadSessionTitles(job.backend, job.projectId, true);
  return jobTitleOf(job, entry.titles);
}

/**
 * Names of the given jobs: the short task at once, the native session title as soon as the
 * agent has named the session. While any job still works, the list is read again, so a title
 * that appears later reaches the header, the dock and the continuation note.
 */
export function useJobTitles(
  projectId: () => string,
  jobs: () => AgentJobView[],
): ComputedRef<Map<string, string>> {
  const names = ref<Map<string, string>>(new Map());
  let timer: ReturnType<typeof setTimeout> | undefined;
  let attempts = 0;
  let generation = 0;

  const signature = () =>
    jobs()
      .map((job) => `${job.id}:${job.backend}:${job.sessionId ?? ""}:${job.status}`)
      .join("|");

  async function refresh(): Promise<void> {
    clearTimeout(timer);
    timer = undefined;
    const list = jobs();
    const mine = ++generation;
    const byBackend = new Map<AgentBackendId, Map<string, string>>();
    const project = projectId();
    if (project) {
      const backends = [...new Set(list.filter(named).map((job) => job.backend))];
      const loaded = await Promise.all(
        backends.map(
          async (backend) => [backend, (await loadSessionTitles(backend, project)).titles] as const,
        ),
      );
      if (mine !== generation) return;
      for (const [backend, titles] of loaded) byBackend.set(backend, titles);
    } else if (mine !== generation) return;
    const next = new Map<string, string>();
    let waiting = false;
    for (const job of list) {
      const titles = byBackend.get(job.backend);
      next.set(job.id, jobTitleOf(job, titles));
      if (named(job) && !titles?.get(job.sessionId!)?.trim() && job.status === "running")
        waiting = true;
    }
    names.value = next;
    if (waiting && attempts < RETRY_LIMIT) {
      attempts++;
      timer = setTimeout(() => void refresh(), RETRY_MS);
    }
  }

  watch(
    [signature, version],
    () => {
      attempts = 0;
      void refresh();
    },
    { immediate: true },
  );
  if (getCurrentScope())
    onScopeDispose(() => {
      generation++;
      clearTimeout(timer);
    });

  return computed(() => names.value);
}

/** The name of one job while its tab is open; the same lookup as the dock and the note. */
export function useJobTitle(projectId: () => string, job: () => AgentJobView | undefined) {
  const names = useJobTitles(projectId, () => {
    const current = job();
    return current ? [current] : [];
  });
  return computed(() => {
    const current = job();
    if (!current) return "Задание";
    return names.value.get(current.id) ?? jobTitleOf(current);
  });
}
