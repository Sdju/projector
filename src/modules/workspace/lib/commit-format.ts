const units: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 31_536_000],
  ["month", 2_592_000],
  ["week", 604_800],
  ["day", 86_400],
  ["hour", 3600],
  ["minute", 60],
];
const relative = new Intl.RelativeTimeFormat("ru", { numeric: "auto", style: "short" });
const absolute = new Intl.DateTimeFormat("ru", { dateStyle: "long", timeStyle: "short" });

export const shortHash = (hash: string) => hash.slice(0, 7);
/** «5 мин. назад»; будущая дата (часы не сходятся) показывается как «сейчас». */
export function relativeTime(iso: string, now = Date.now()) {
  const seconds = Math.round((now - Date.parse(iso)) / 1000);
  if (!Number.isFinite(seconds)) return "";
  for (const [unit, size] of units)
    if (seconds >= size) return relative.format(-Math.floor(seconds / size), unit);
  return seconds < 45 ? "только что" : relative.format(-1, "minute");
}
export function absoluteTime(iso: string) {
  const time = Date.parse(iso);
  return Number.isFinite(time) ? absolute.format(time) : "";
}
