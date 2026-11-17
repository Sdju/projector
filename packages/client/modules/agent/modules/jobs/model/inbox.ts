import { computed, getCurrentScope, onScopeDispose, ref } from "vue";
import type { HubDevice } from "@ai-projector/core/modules/hub/index.ts";
import {
  deviceApiUrl,
  fetchJobs,
  fetchRunsFeed,
  notifyInbox,
  type AgentJobView,
} from "../../../../agent-core/index.ts";
import { fetchHubPresence, hubNoticeAllowed, type HubPresence } from "../../../../hub/index.ts";
import {
  FINISHED_TTL_MS,
  inboxGroups,
  inboxHref,
  inboxJobItem,
  inboxNotices,
  inboxSourcesFromDevices,
  mergeRunItems,
  currentDeviceId,
  type InboxItem,
  type InboxProject,
  type InboxSource,
} from "./inbox-view.ts";
import {
  isItemAttention,
  isItemUnread,
  markAllInboxItemsRead,
  markInboxItemRead,
  markOldFinishedAsRead,
} from "./inbox-read.ts";
import { feedJobs, feedRecentRuns, feedRuns, onJobsFeedUpdate, useJobsFeed } from "./jobs-feed.ts";
import { trustNoticeUnread, useTrustNotices } from "./trust-notices.ts";

export * from "./inbox-view.ts";
export {
  isItemAcknowledgeable,
  isItemAttention,
  isItemUnread,
  markInboxItemRead,
} from "./inbox-read.ts";

/**
 * The server pushes job and run changes over the page event stream. This timer only keeps the
 * Hub devices and project names fresh and repairs a stream that dropped a change.
 */
const POLL_MS = 30_000;
const PROJECT_TTL_MS = 30_000;
const SOURCES_TTL_MS = 30_000;

async function json<T>(base: string | undefined, path: string): Promise<T> {
  const response = await fetch(deviceApiUrl(base, path), {
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
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
  const signal = AbortSignal.timeout(10_000);
  const [jobs, runsFeed, projects] = await Promise.all([
    fetchJobs(undefined, base, signal),
    fetchRunsFeed(base, signal),
    projectsOf(source, fresh),
  ]);
  return [
    ...jobs.filter(inboxRelevant).map((job) => inboxJobItem(source, job, projects)),
    ...mergeRunItems(source, runsFeed.runs, runsFeed.recent, projects),
  ];
}

/** Jobs and runs of this server come from the shared feed, which the server keeps up to date. */
function localItems(source: InboxSource, projects: readonly InboxProject[]): InboxItem[] {
  return [
    ...feedJobs.value.filter(inboxRelevant).map((job) => inboxJobItem(source, job, projects)),
    ...mergeRunItems(source, feedRuns.value, feedRecentRuns.value, projects),
  ];
}

const hub = ref<HubPresence>({ devices: [], activity: {} });

function sourcesFor(presence: HubPresence): InboxSource[] {
  const current = currentDeviceId();
  if (current) return inboxSourcesFromDevices(presence.devices, current);
  const local = { id: "", name: "Это устройство", base: "", current: true };
  const remote = presence.relay
    ? inboxSourcesFromDevices(
        presence.devices.filter((device) => device.id !== presence.deviceId),
        "",
      )
    : [];
  return [local, ...remote];
}

export async function fetchInboxSources(): Promise<InboxSource[]> {
  try {
    hub.value = await fetchHubPresence();
  } catch {
    // A failed snapshot is transient; leave the last known sources available for retries.
  }
  return sourcesFor(hub.value);
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
const pendingSources = new Set<string>();
const failedSources = new Map<string, string>();

function drainSources(): void {
  if (disposed || refreshing || loading.value || !pendingSources.size) return;
  const ids = new Set(pendingSources);
  pendingSources.clear();
  void refresh(false, false, ids);
}

async function sourcesOf(fresh: boolean): Promise<InboxSource[]> {
  if (!fresh && sourcesAt && Date.now() - sourcesAt < SOURCES_TTL_MS) return sources.value;
  sources.value = await fetchInboxSources();
  sourcesAt = Date.now();
  return sources.value;
}

/** Rebuilds the list from the per-source cache; a source that failed keeps its last known items. */
function publishItems(list: readonly InboxSource[]): void {
  const next = list.flatMap((source) => cache.get(source.id) ?? []);
  if (firstLook) markOldFinishedAsRead(next);
  items.value = next;
  updatedAt.value = Date.now();
  const current = currentDeviceId();
  const byKey = new Map(next.map((item) => [item.key, item]));
  const notices = inboxNotices(seen, next, firstLook, (item) => inboxHref(item, list)).filter(
    (notice) => {
      const item = byKey.get(notice.key);
      return (
        !item || !item.sourceId || item.sourceId === current || hubNoticeAllowed(item.sourceId)
      );
    },
  );
  firstLook = false;
  for (const notice of notices) notifyInbox(notice.key, notice.title, notice.body, notice.href);
}

async function refresh(fresh = false, localOnly = false, ids?: ReadonlySet<string>): Promise<void> {
  if (refreshing) {
    if (fresh) rerunAll = true;
    else if (localOnly) rerun = true;
    return refreshing;
  }
  refreshing = (async () => {
    try {
      const list = await sourcesOf(fresh);
      if (disposed) return;
      const selected = list.filter((source) =>
        source.current ? !ids : !localOnly && (!ids || ids.has(source.id)),
      );
      const results = await Promise.allSettled(
        selected.map((source) => {
          // This page's own server pushes changes: its list comes from the shared feed.
          if (source.current)
            return projectsOf(source, fresh).then((projects) => localItems(source, projects));
          return loadSource(source, fresh);
        }),
      );
      if (disposed) return;
      results.forEach((result, index) => {
        const source = selected[index]!;
        if (!sources.value.some((current) => current.id === source.id)) return;
        if (result.status === "fulfilled") {
          cache.set(source.id, result.value);
          failedSources.delete(source.id);
        } else {
          failedSources.set(source.id, source.name);
        }
      });
      const failed = sources.value.flatMap(({ id }) => failedSources.get(id) ?? []);
      error.value = failed.length
        ? `Нет ответа: ${failed.join(", ")}. Показано последнее известное состояние.`
        : "";
      publishItems(sources.value);
    } catch (cause) {
      if (!disposed)
        error.value = cause instanceof Error ? cause.message : "Не удалось прочитать работы";
    } finally {
      if (!disposed) loading.value = false;
      refreshing = undefined;
      if (!disposed && rerunAll) {
        rerunAll = false;
        void refresh(true);
      } else if (!disposed && rerun) {
        rerun = false;
        void refresh(false, true);
      } else drainSources();
    }
  })();
  return refreshing;
}

/** The Hub pushes its device list; pages behind it update sources without polling. */
function applyHubDevices(event: Event): void {
  const devices = (event as CustomEvent<{ devices?: unknown }>).detail?.devices;
  if (!Array.isArray(devices)) return;
  const list = devices.filter((item): item is HubDevice => {
    if (!item || typeof item !== "object") return false;
    const value = item as Record<string, unknown>;
    return (
      typeof value.id === "string" &&
      typeof value.name === "string" &&
      typeof value.protocol === "number" &&
      typeof value.online === "boolean"
    );
  });
  hub.value = { ...hub.value, devices: list };
  sources.value = sourcesFor(hub.value);
  sourcesAt = Date.now();
  for (const id of Array.from(cache.keys())) {
    if (sources.value.some((source) => source.id === id)) continue;
    cache.delete(id);
    failedSources.delete(id);
  }
  publishItems(sources.value);
  // Re-read presence too: a device event can follow a connector reconnect or Hub switch.
  if (!currentDeviceId() || hub.value.local) void refresh(true);
  else if (refreshing || loading.value) rerunAll = true;
  else void refresh();
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
    const detail = (event as CustomEvent<{ deviceId?: unknown; at?: unknown }>).detail;
    const deviceId = detail?.deviceId;
    if (typeof deviceId !== "string") return;
    const at =
      typeof detail?.at === "number" && Number.isFinite(detail.at) ? detail.at : Date.now();
    hub.value = {
      ...hub.value,
      activity: { ...hub.value.activity, [deviceId]: at },
    };
    pendingSources.add(deviceId);
    drainSources();
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
    pendingSources.clear();
    failedSources.clear();
  };
}

export const markAllInboxRead = (): void => markAllInboxItemsRead(items.value);

/** The header and the rail icon ask for the same number without starting a second poll. */
export const inboxAttention = () =>
  items.value.filter(isItemAttention).length + trustNoticeUnread();
export const inboxUnread = () => items.value.filter(isItemUnread).length;
export const inboxBadge = () => inboxAttention() + inboxUnread();

/** Requests of other devices, for the Hub section on the right rail. */
export const inboxRemoteAttention = () => {
  const current = currentDeviceId();
  return items.value.filter(
    (item) => !!item.sourceId && item.sourceId !== current && isItemAttention(item),
  ).length;
};

let stopPolling: (() => void) | undefined;

/** The one inbox of the page: the panel and the header bell share its polling and state. */
export function useAgentInbox() {
  useJobsFeed();
  const trust = useTrustNotices();
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
  const attention = computed(() => items.value.filter(isItemAttention).length + trust.unread.value);
  const unread = computed(() => items.value.filter(isItemUnread).length);
  const badgeCount = computed(() => attention.value + unread.value);
  const working = computed(() => items.value.filter((item) => item.category === "working").length);
  const finished = computed(
    () => items.value.filter((item) => item.category === "finished").length,
  );
  return {
    items,
    groups,
    sources,
    hub,
    loading,
    error,
    updatedAt,
    attention,
    unread,
    badgeCount,
    working,
    finished,
    notices: trust.notices,
    noticeUnread: trust.unread,
    isNoticeRead: trust.isRead,
    noticeHref: trust.noticeHref,
    markNoticeRead: trust.markRead,
    markAllNoticesRead: trust.markAllRead,
    restoreNotice: trust.restore,
    isUnread: isItemUnread,
    isAttention: isItemAttention,
    markRead: markInboxItemRead,
    markAllRead: markAllInboxRead,
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
