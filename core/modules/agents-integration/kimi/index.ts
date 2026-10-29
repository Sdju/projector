export interface KimiUsageWindow {
  usedPercent: number;
  resetsAt: number | null;
  limited: boolean;
}

/** Windows the plan exposes: 5 hours and a month are common, a week exists only on some plans. */
export interface KimiUsage {
  status: "ready" | "unavailable";
  windows: Partial<Record<"rolling" | "weekly" | "monthly", KimiUsageWindow>> | null;
  checkedAt: number;
  message: string | null;
}
