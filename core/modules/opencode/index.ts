export interface OpenCodeUsageWindow {
  usedPercent: number;
  resetsAt: number | null;
  limited: boolean;
}

export interface OpenCodeUsage {
  status: "ready" | "unavailable";
  windows: Record<"rolling" | "weekly" | "monthly", OpenCodeUsageWindow> | null;
  checkedAt: number;
  message: string | null;
}
