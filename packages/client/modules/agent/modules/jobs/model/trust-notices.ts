import { computed, getCurrentScope, onScopeDispose, ref } from "vue";
import type { TrustNotice } from "@ai-projector/core/modules/trust-notices/index.ts";
import { deviceApiUrl, notifyInbox } from "../../../../agent-core/index.ts";
import { deviceBase } from "../../../../../common/utilities/device-url.ts";
import { projectRoute } from "../../../../project/index.ts";

/** Read notices are still listed; the mark only clears the attention counter. */
const READ_KEY = `projector:trust-notices-read:${deviceBase() || "local"}`;

const notices = ref<TrustNotice[]>([]);
const readIds = ref<Set<string>>(loadReadIds());

function loadReadIds(): Set<string> {
  try {
    const value = JSON.parse(localStorage.getItem(READ_KEY) ?? "[]");
    return new Set(
      Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [],
    );
  } catch {
    return new Set();
  }
}

function storeReadIds(ids: Set<string>): void {
  try {
    localStorage.setItem(READ_KEY, JSON.stringify([...ids]));
  } catch {
    // Storage can be full or blocked; the notice still works for this page.
  }
}

const unread = computed(
  () => notices.value.filter((notice) => !readIds.value.has(notice.id)).length,
);

function markRead(id: string): void {
  if (readIds.value.has(id)) return;
  const next = new Set(readIds.value);
  next.add(id);
  readIds.value = next;
  storeReadIds(next);
}

function markAllRead(): void {
  const next = new Set(readIds.value);
  for (const notice of notices.value) next.add(notice.id);
  if (next.size === readIds.value.size) return;
  readIds.value = next;
  storeReadIds(next);
}

/** The settings page of this device, or the project settings section a trust notice points at. */
function noticeHref(notice: TrustNotice): string {
  if (notice.projectPath) {
    const section = notice.section ? `?settings=${encodeURIComponent(notice.section)}` : "";
    return `${deviceBase()}${projectRoute(notice.projectPath)}${section}`;
  }
  return `${deviceBase()}${notice.href ?? ""}`;
}

/** A file can change outside the watched project tree; the slow poll catches that case. */
const POLL_MS = 60_000;

let subscribers = 0;
let stopListeners: (() => void) | undefined;
let timer: ReturnType<typeof setInterval> | undefined;
let refreshing: Promise<void> | undefined;
let rerun = false;
let firstLook = true;
let seen = new Set<string>();

function apply(next: readonly TrustNotice[], notifyNew: boolean): void {
  const previous = seen;
  const present = new Set(next.map((notice) => notice.id));
  seen = present;
  // Drop ids that are no longer on the server: if the same file is revoked again later,
  // the new notice must start unread.
  if ([...readIds.value].some((id) => !present.has(id))) {
    const kept = new Set([...readIds.value].filter((id) => present.has(id)));
    readIds.value = kept;
    storeReadIds(kept);
  }
  notices.value = [...next];
  if (notifyNew && !firstLook)
    for (const notice of next)
      if (!previous.has(notice.id) && !readIds.value.has(notice.id))
        notifyInbox(`trust:${notice.id}`, notice.title, notice.body, noticeHref(notice));
  firstLook = false;
}

async function load(): Promise<void> {
  try {
    const response = await fetch(deviceApiUrl(undefined, "/api/trust-notices"), {
      cache: "no-store",
    });
    if (!response.ok) return;
    const data = (await response.json()) as { notices?: TrustNotice[] };
    apply(Array.isArray(data.notices) ? data.notices : [], true);
  } catch {
    // The feed is auxiliary: the settings card and its diagnostic still exist on its page.
  }
}

/** Confirms the current contents of the file behind one notice. */
async function restore(id: string): Promise<void> {
  const response = await fetch(deviceApiUrl(undefined, "/api/trust-notices"), {
    method: "POST",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id }),
  });
  const data = (await response.json().catch(() => ({}))) as {
    notices?: TrustNotice[];
    error?: string;
  };
  if (!response.ok) throw new Error(data.error || "Не удалось вернуть доверие");
  apply(Array.isArray(data.notices) ? data.notices : [], false);
}

async function refresh(): Promise<void> {
  if (refreshing) {
    rerun = true;
    return refreshing;
  }
  refreshing = (async () => {
    try {
      do {
        rerun = false;
        await load();
      } while (rerun);
    } finally {
      refreshing = undefined;
    }
  })();
  return refreshing;
}

function start(): () => void {
  const onChanged = () => void refresh();
  window.addEventListener("projector:trust-notices-changed", onChanged);
  window.addEventListener("projector:events-open", onChanged);
  timer = setInterval(() => void refresh(), POLL_MS);
  void refresh();
  return () => {
    window.removeEventListener("projector:trust-notices-changed", onChanged);
    window.removeEventListener("projector:events-open", onChanged);
    if (timer !== undefined) clearInterval(timer);
    timer = undefined;
    firstLook = true;
    seen = new Set();
  };
}

/**
 * Trust notices of this page's device, shared by the bell, the inbox panel and the sidebar badge.
 * The server pushes `trust-notices-changed`, so the list does not poll.
 */
export function useTrustNotices() {
  if (!subscribers) stopListeners = start();
  subscribers++;
  if (getCurrentScope())
    onScopeDispose(() => {
      subscribers = Math.max(0, subscribers - 1);
      if (!subscribers) {
        stopListeners?.();
        stopListeners = undefined;
      }
    });
  return {
    notices,
    unread,
    isRead: (notice: TrustNotice) => readIds.value.has(notice.id),
    noticeHref,
    markRead,
    markAllRead,
    restore,
    refresh: () => refresh(),
  };
}

/** The number for the rail badge, without starting a second fetch. */
export const trustNoticeUnread = (): number => unread.value;

import.meta.hot?.dispose(() => {
  stopListeners?.();
  stopListeners = undefined;
  if (timer !== undefined) clearInterval(timer);
  timer = undefined;
  subscribers = 0;
  firstLook = true;
  seen = new Set();
});
