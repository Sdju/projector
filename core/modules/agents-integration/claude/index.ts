export interface ClaudeUsageWindow {
  usedPercent: number;
  resetsAt: number | null;
  limited: boolean;
}

export interface ClaudeUsage {
  status: "ready" | "unavailable";
  windows: { rolling: ClaudeUsageWindow | null; weekly: ClaudeUsageWindow | null } | null;
  checkedAt: number;
  nextCheckAt: number;
  message: string | null;
}
