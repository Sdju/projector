import { ref } from "vue";
import { RECENT_UNREAD_MS, type InboxItem } from "./inbox-view.ts";

const READ_STORAGE_KEY = "projector:inbox-read";
const READ_LIMIT = 200;

function loadReadMap(): Record<string, string> {
  try {
    const raw = localStorage.getItem(READ_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    );
  } catch {
    return {};
  }
}

function saveReadMap(map: Record<string, string>): void {
  try {
    const entries = Object.entries(map).slice(-READ_LIMIT);
    localStorage.setItem(READ_STORAGE_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    // Private mode or non-browser test environment.
  }
}

export const readSignature = (item: InboxItem): string =>
  `${item.status}|${item.endedAt ?? ""}|${item.awaitingReply ? "reply" : ""}|${item.pending.map((card) => card.id).join(",")}`;

export const readMap = ref<Record<string, string>>(loadReadMap());

export function markOldFinishedAsRead(items: readonly InboxItem[], now = Date.now()): void {
  let changed = false;
  const updated = { ...readMap.value };
  for (const item of items) {
    if (
      item.category === "finished" &&
      updated[item.key] === undefined &&
      now - (item.endedAt ?? item.createdAt) >= RECENT_UNREAD_MS
    ) {
      updated[item.key] = readSignature(item);
      changed = true;
    }
  }
  if (!changed) return;
  readMap.value = updated;
  saveReadMap(updated);
}

export const isItemAcknowledgeable = (item: InboxItem): boolean =>
  item.category === "finished" || (item.category === "attention" && item.pending.length === 0);

export const isItemUnread = (item: InboxItem): boolean =>
  item.category === "finished" && readMap.value[item.key] !== readSignature(item);

export const isItemAttention = (item: InboxItem): boolean =>
  item.category === "attention" &&
  (item.pending.length > 0 || readMap.value[item.key] !== readSignature(item));

export function markInboxItemRead(item: InboxItem): void {
  if (!isItemAcknowledgeable(item)) return;
  const sig = readSignature(item);
  if (readMap.value[item.key] === sig) return;
  const next = { ...readMap.value, [item.key]: sig };
  readMap.value = next;
  saveReadMap(next);
}

export function markAllInboxItemsRead(items: readonly InboxItem[]): void {
  const next = { ...readMap.value };
  let changed = false;
  for (const item of items) {
    if (!isItemAcknowledgeable(item)) continue;
    const sig = readSignature(item);
    if (next[item.key] !== sig) {
      next[item.key] = sig;
      changed = true;
    }
  }
  if (!changed) return;
  readMap.value = next;
  saveReadMap(next);
}
