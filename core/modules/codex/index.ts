export interface CodexUsageWindow {
  usedPercent: number;
  windowDurationMins: number;
  resetsAt: number | null;
}

export interface CodexUsage {
  status: "ready" | "unavailable";
  weekly: CodexUsageWindow | null;
  checkedAt: number;
  message: string | null;
}
