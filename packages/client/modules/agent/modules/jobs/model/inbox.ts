import { computed, getCurrentScope, onScopeDispose, ref } from "vue";
import {
  deviceApiUrl,
  fetchJobs,
  fetchLiveRuns,
  notifyInbox,
  type AgentJobView,
  type LiveAgentRun,
} from "../../../../agent-core/index.ts";
import { fetchHubDevices } from "../../../../hub/index.ts";
import {
  FINISHED_TTL_MS,
  inboxGroups,
  inboxHref,
  inboxJobItem,
  inboxNotices,
  inboxRunItem,
  inboxSourcesFromDevices,
  currentDeviceId,
  type InboxItem,
  type InboxProject,
  type InboxSource,
} from "./inbox-view.ts";

export * from "./inbox-view.ts";

/** How often the whole page asks for work. Hidden pages keep polling so they can notify. */
const POLL_MS = 5000;
const PROJECT_TTL_MS = 30_000;

async function json<T>(base: string | undefined, path: string): Promise<T> {
  const response = await fetch(deviceApiUrl(base, path), { cache: "no-store" });
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(data.error || `Запрос не удался (${response.status})`);
  return data;
}

const projectCache = new Map<string, { at: number; projects: InboxProject[] }>();

async function projectsOf(source: InboxSource, fresh: boolean): Promise<InboxProject[]> {
  const cached = projectCache.get(source.id);
  if (!fresh && cached && Date.now() - cached.at < PROJECT_TTL_MS) return cached.projects;
  try {
    const data = await json<{ projects: InboxProject[] }>(
      source.base || undefined,
      "/api/projects",
    );
    const projects = (data.projects ?? []).map(({ id, name, path }) => ({ id, name, path }));
    projectCache.set(source.id, { at: Date.now(), projects });
    return projects;
  } catch {
    return cached?.projects ?? [];
  }
}

const finishedRecently = (job: AgentJobView) =>
  Date.now() - (job.endedAt ?? job.createdAt) < FINISHED_TTL_MS;

/** Running work and open requests stay; old errors and answers are history, not an alert. */
const inboxRelevant = (job: AgentJobView) =>
  job.status === "running" ||
  job.status === "queued" ||
  job.status === "needs-user" ||
  job.pending.length > 0 ||
  finishedRecently(job);

async function loadSource(source: InboxSource, fresh: boolean): Promise<InboxItem[]> {
  const base = source.base || undefined;
  const [jobs, runs, projects] = await Promise.all([
    fetchJobs(undefined, base),
    fetchLiveRuns(base).catch(() => [] as LiveAgentRun[]),
    projectsOf(source, fresh),
  ]);
  return [
    ...jobs.filter(inboxRelevant).map((job) => inboxJobItem(source, job, projects)),
    ...runs.map((run) => inboxRunItem(source, run, projects)),
  ];
}

export async function fetchInboxSources(): Promise<InboxSource[]> {
  const current = currentDeviceId();
  if (!current) return [{ id: "", name: "Это устройство", base: "", current: true }];
  try {
    return inboxSourcesFromDevices(await fetchHubDevices(), current);
  } catch {
    return [{ id: current, name: "Это устройство", base: "", current: true }];
  }
}

const items = ref<InboxItem[]>([]);
const sources = ref<InboxSource[]>([{ id: "", name: "Это устройство", base: "", current: true }]);
const loading = ref(true);
const error = ref("");
const updatedAt = ref(0);
const cache = new Map<string, InboxItem[]>();
const seen = new Map<string, string>();
let firstLook = true;
let timer: ReturnType<typeof setInterval> | undefined;
let refreshing: Promise<void> | undefined;
let subscribers = 0;
let disposed = false;

async function refresh(fresh = false): Promise<void> {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    try {
      const list = await fetchInboxSources();
      if (disposed) return;
      sources.value = list;
      const results = await Promise.allSettled(list.map((source) => loadSource(source, fresh)));
      if (disposed) return;
      const next: InboxItem[] = [];
      const failed: string[] = [];
      results.forEach((result, index) => {
        const source = list[index]!;
        if (result.status === "fulfilled") {
          cache.set(source.id, result.value);
          next.push(...result.value);
        } else {
          failed.push(source.name);
          next.push(...(cache.get(source.id) ?? []));
        }
      });
      items.value = next;
      error.value = failed.length
        ? `Нет ответа: ${failed.join(", ")}. Показано последнее известное состояние.`
        : "";
      updatedAt.value = Date.now();
      const notices = inboxNotices(seen, next, firstLook, (item) => inboxHref(item, list));
      firstLook = false;
      for (const notice of notices) notifyInbox(notice.key, notice.title, notice.body, notice.href);
    } catch (cause) {
      if (!disposed)
        error.value = cause instanceof Error ? cause.message : "Не удалось прочитать работы";
    } finally {
      if (!disposed) loading.value = false;
      refreshing = undefined;
    }
  })();
  return refreshing;
}

function start() {
  disposed = false;
  void refresh();
  timer = setInterval(() => void refresh(), POLL_MS);
  // A page that became visible catches up at once; a hidden one keeps the slow poll for notices.
  const onVisible = () => {
    if (document.visibilityState === "visible") void refresh(true);
  };
  document.addEventListener("visibilitychange", onVisible);
  return () => {
    document.removeEventListener("visibilitychange", onVisible);
    if (timer !== undefined) clearInterval(timer);
    timer = undefined;
  };
}

/** The header and the rail icon ask for the same number without starting a second poll. */
export const inboxAttention = () =>
  items.value.filter((item) => item.category === "attention").length;

let stopPolling: (() => void) | undefined;

/** The one inbox of the page: the panel and the header bell share its polling and state. */
export function useAgentInbox() {
  if (!subscribers) stopPolling = start();
  subscribers++;
  if (getCurrentScope())
    onScopeDispose(() => {
      subscribers = Math.max(0, subscribers - 1);
      if (!subscribers) {
        stopPolling?.();
        stopPolling = undefined;
        disposed = true;
      }
    });
  const groups = computed(() => inboxGroups(items.value));
  const attention = computed(
    () => items.value.filter((item) => item.category === "attention").length,
  );
  const working = computed(() => items.value.filter((item) => item.category === "working").length);
  const finished = computed(
    () => items.value.filter((item) => item.category === "finished").length,
  );
  return {
    items,
    groups,
    sources,
    loading,
    error,
    updatedAt,
    attention,
    working,
    finished,
    refresh: () => refresh(true),
    href: (item: InboxItem) => inboxHref(item, sources.value),
  };
}

import.meta.hot?.dispose(() => {
  stopPolling?.();
  stopPolling = undefined;
  disposed = true;
  subscribers = 0;
});
