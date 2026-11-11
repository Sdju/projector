import { computed, getCurrentScope, onScopeDispose, ref } from "vue";
import type { HubDevice } from "@ai-projector/core/modules/hub/index.ts";
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
import { feedJobs, feedRuns, onJobsFeedUpdate, useJobsFeed } from "./jobs-feed.ts";

export * from "./inbox-view.ts";

/**
 * The server pushes job and run changes over the page event stream. This timer only keeps the
 * Hub devices and project names fresh and repairs a stream that dropped a change.
 */
const POLL_MS = 30_000;
const PROJECT_TTL_MS = 30_000;
const SOURCES_TTL_MS = 30_000;

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

/** Jobs and runs of this server come from the shared feed, which the server keeps up to date. */
function localItems(source: InboxSource, projects: readonly InboxProject[]): InboxItem[] {
  return [
    ...feedJobs.value.filter(inboxRelevant).map((job) => inboxJobItem(source, job, projects)),
    ...feedRuns.value.map((run) => inboxRunItem(source, run, projects)),
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
let stopFeed: (() => void) | undefined;
let refreshing: Promise<void> | undefined;
let rerun = false;
let rerunAll = false;
let sourcesAt = 0;
let subscribers = 0;
let disposed = false;
const refreshingSources = new Set<string>();

async function sourcesOf(fresh: boolean): Promise<InboxSource[]> {
  if (!fresh && sourcesAt && Date.now() - sourcesAt < SOURCES_TTL_MS) return sources.value;
  sources.value = await fetchInboxSources();
  sourcesAt = Date.now();
  return sources.value;
}

/** Rebuilds the list from the per-source cache; a source that failed keeps its last known items. */
function publishItems(list: readonly InboxSource[]): void {
  const next = list.flatMap((source) => cache.get(source.id) ?? []);
  items.value = next;
  updatedAt.value = Date.now();
  const notices = inboxNotices(seen, next, firstLook, (item) => inboxHref(item, list));
  firstLook = false;
  for (const notice of notices) notifyInbox(notice.key, notice.title, notice.body, notice.href);
}

async function refresh(fresh = false, localOnly = false): Promise<void> {
  if (refreshing) {
    if (localOnly) rerun = true;
    return refreshing;
  }
  refreshing = (async () => {
    try {
      const list = await sourcesOf(fresh);
      if (disposed) return;
      const results = await Promise.allSettled(
        list.map((source) => {
          // This page's own server pushes changes: its list comes from the shared feed.
          if (source.current)
            return projectsOf(source, fresh).then((projects) => localItems(source, projects));
          // A change pushed by this server must not read every Hub device again.
          if (localOnly) return Promise.resolve(cache.get(source.id) ?? []);
          return loadSource(source, fresh);
        }),
      );
      if (disposed) return;
      const failed: string[] = [];
      results.forEach((result, index) => {
        const source = list[index]!;
        if (result.status === "fulfilled") cache.set(source.id, result.value);
        else failed.push(source.name);
      });
      error.value = failed.length
        ? `Нет ответа: ${failed.join(", ")}. Показано последнее известное состояние.`
        : "";
      publishItems(list);
    } catch (cause) {
      if (!disposed)
        error.value = cause instanceof Error ? cause.message : "Не удалось прочитать работы";
    } finally {
      if (!disposed) loading.value = false;
      refreshing = undefined;
      if (!disposed && rerunAll) {
        rerunAll = false;
        void refresh(false);
      } else if (!disposed && rerun) {
        rerun = false;
        void refresh(false, true);
      }
    }
  })();
  return refreshing;
}

/** A Hub event names one device: read only that source, not every other device. */
async function refreshSource(id: string): Promise<void> {
  if (disposed || loading.value) return;
  const source = sources.value.find((item) => item.id === id && !item.current);
  if (!source || refreshingSources.has(id)) return;
  refreshingSources.add(id);
  try {
    const items = await loadSource(source, false);
    if (disposed) return;
    cache.set(id, items);
    publishItems(sources.value);
  } catch {
    // The timer keeps the last known state; the device may be restarting.
  } finally {
    refreshingSources.delete(id);
  }
}

/** The Hub pushes its device list; pages behind it update sources without polling. */
function applyHubDevices(event: Event): void {
  const devices = (event as CustomEvent<{ devices?: unknown }>).detail?.devices;
  const current = currentDeviceId();
  if (!current || !Array.isArray(devices)) return;
  const online = devices.filter((item): item is HubDevice => {
    if (!item || typeof item !== "object") return false;
    const value = item as Record<string, unknown>;
    return (
      typeof value.id === "string" &&
      typeof value.name === "string" &&
      typeof value.protocol === "number" &&
      typeof value.online === "boolean"
    );
  });
  sources.value = inboxSourcesFromDevices(online, current);
  sourcesAt = Date.now();
  for (const id of Array.from(cache.keys()))
    if (!sources.value.some((source) => source.id === id)) cache.delete(id);
  if (refreshing || loading.value) {
    rerunAll = true;
    return;
  }
  publishItems(sources.value);
  void refresh(false);
}

function start() {
  disposed = false;
  void refresh();
  timer = setInterval(() => void refresh(true), POLL_MS);
  // The server pushes job and run changes; only a dropped event waits for the timer.
  stopFeed = onJobsFeedUpdate(() => void refresh(false, true));
  // A page that became visible catches up at once; a hidden one keeps the slow poll for notices.
  const onVisible = () => {
    if (document.visibilityState === "visible") void refresh(true);
  };
  const onHubDevices = (event: Event) => applyHubDevices(event);
  const onHubActivity = (event: Event) => {
    const deviceId = (event as CustomEvent<{ deviceId?: unknown }>).detail?.deviceId;
    if (typeof deviceId === "string") void refreshSource(deviceId);
  };
  if (typeof window !== "undefined") {
    window.addEventListener("projector:hub-devices", onHubDevices);
    window.addEventListener("projector:hub-activity", onHubActivity);
  }
  document.addEventListener("visibilitychange", onVisible);
  return () => {
    document.removeEventListener("visibilitychange", onVisible);
    if (typeof window !== "undefined") {
      window.removeEventListener("projector:hub-devices", onHubDevices);
      window.removeEventListener("projector:hub-activity", onHubActivity);
    }
    if (timer !== undefined) clearInterval(timer);
    timer = undefined;
    stopFeed?.();
    stopFeed = undefined;
    sourcesAt = 0;
    rerun = false;
    rerunAll = false;
    refreshingSources.clear();
  };
}

/** The header and the rail icon ask for the same number without starting a second poll. */
export const inboxAttention = () =>
  items.value.filter((item) => item.category === "attention").length;

let stopPolling: (() => void) | undefined;

/** The one inbox of the page: the panel and the header bell share its polling and state. */
export function useAgentInbox() {
  useJobsFeed();
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
