/** Reset timestamps use Unix seconds; countdowns share the browser's local clock. */
export function resetCountdown(resetsAt: number | null | undefined, now = Date.now()): string {
  if (!resetsAt || !Number.isFinite(resetsAt)) return "—";
  const seconds = resetsAt - now / 1000;
  if (seconds <= 0) return "сейчас";
  if (seconds < 60) return "<1м";
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days) return `${days}д${hours % 24 ? ` ${hours % 24}ч` : ""}`;
  if (hours) return `${hours}ч${minutes % 60 ? ` ${minutes % 60}м` : ""}`;
  return `${minutes}м`;
}

export function resetTimestamp(resetsAt: number | null | undefined): string {
  if (!resetsAt || !Number.isFinite(resetsAt)) return "—";
  return new Date(resetsAt * 1000).toLocaleString(undefined, {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
