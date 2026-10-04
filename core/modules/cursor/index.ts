export interface CursorUsageWindow {
  usedPercent: number;
  resetsAt: number | null;
  limited: boolean;
}

export interface CursorUsage {
  status: "ready" | "unavailable";
  windows: Record<"total" | "auto" | "api", CursorUsageWindow> | null;
  checkedAt: number;
  message: string | null;
}
