/** Full cycle lengths: pace compares spent % to elapsed fraction of this maximum. */
export const USAGE_PERIOD_SECONDS = {
  hours5: 5 * 3600,
  week: 7 * 86400,
  month: 30 * 86400,
} as const;

/** Blue spare → gray normal → yellow hot → red over. */
export type UsagePaceTone = "spare" | "normal" | "hot" | "over";

/**
 * Pace of limit spend vs time left until reset.
 * `periodSeconds` is the maximum time-to-reset at cycle start (week/month/5h).
 * Weekly and monthly windows are judged on a day-scale period; rolling uses hours.
 */
export function usagePaceTone(
  usedPercent: number,
  resetsAt: number | null | undefined,
  periodSeconds: number,
  now = Date.now(),
  limited = false,
): UsagePaceTone | null {
  if (!Number.isFinite(usedPercent) || usedPercent < 0) return null;
  if (!Number.isFinite(periodSeconds) || periodSeconds <= 0) return null;
  if (limited || usedPercent >= 100) return "over";
  if (!resetsAt || !Number.isFinite(resetsAt)) return null;

  const remainingSeconds = Math.max(0, resetsAt - now / 1000);
  const remainingFraction = Math.min(1, remainingSeconds / periodSeconds);
  const expectedUsed = (1 - remainingFraction) * 100;
  const delta = usedPercent - expectedUsed;

  if (delta <= -15) return "spare";
  if (delta <= 8) return "normal";
  if (delta <= 22) return "hot";
  return "over";
}
