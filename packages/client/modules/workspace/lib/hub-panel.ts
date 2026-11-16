import type { HubDevice } from "@ai-projector/core/modules/hub/index.ts";
import { isItemAttention, isItemUnread, type InboxItem } from "../../agent/index.ts";

/** Own device first, then online machines, then names: the rail has room for a short list. */
export function sortHubDevices(devices: readonly HubDevice[], self: string): HubDevice[] {
  return [...devices].sort(
    (left, right) =>
      Number(right.id === self) - Number(left.id === self) ||
      Number(right.online) - Number(left.online) ||
      left.name.localeCompare(right.name),
  );
}

/** A local page reads its own work from `/api/…`; a Hub page from `/api/devices/<id>/…`. */
export function hubSourceId(device: HubDevice, self: string, hubPage: boolean): string {
  if (hubPage) return device.id;
  return device.id === self ? "" : device.id;
}

export function hubDeviceItems(
  items: readonly InboxItem[],
  device: HubDevice,
  self: string,
  hubPage: boolean,
): InboxItem[] {
  const source = hubSourceId(device, self, hubPage);
  return items
    .filter((item) => item.sourceId === source)
    .sort(
      (left, right) => (right.startedAt ?? right.createdAt) - (left.startedAt ?? left.createdAt),
    );
}

export interface HubDeviceCounts {
  attention: number;
  working: number;
  unread: number;
}

export function hubDeviceCounts(items: readonly InboxItem[]): HubDeviceCounts {
  return {
    attention: items.filter((item) => isItemAttention(item)).length,
    working: items.filter((item) => item.category === "working").length,
    unread: items.filter((item) => isItemUnread(item)).length,
  };
}

export function hubCountsText(counts: HubDeviceCounts): string {
  const parts: string[] = [];
  if (counts.attention)
    parts.push(`${counts.attention} ${counts.attention === 1 ? "ждёт" : "ждут"} ответа`);
  if (counts.working)
    parts.push(`${counts.working} ${counts.working === 1 ? "работает" : "работают"}`);
  if (counts.unread) parts.push(`${counts.unread} ${counts.unread === 1 ? "новый" : "новых"}`);
  return parts.join(" · ");
}

export function hubItemState(item: InboxItem): string {
  if (item.pending.length || item.status === "needs-user") return "ждёт ответа";
  if (item.status === "error") return "ошибка";
  if (item.status === "running" || item.status === "queued") return "работает";
  if (item.status === "done") return "готово";
  return "остановлено";
}

export function hubActivityText(at: number | undefined): string {
  if (!at) return "";
  return `активность в ${new Date(at).toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
  })}`;
}
