export type AntigravitySkillStatus = "missing" | "installed" | "outdated";

/** State of the user-installed Antigravity skill (`~/.gemini/config/skills/projector/SKILL.md`). */
export interface AntigravitySkillState {
  status: AntigravitySkillStatus;
  name: string;
  file: string;
  /** Latest generated `SKILL.md` content, so the user can inspect it before installing. */
  content: string;
}

export interface AntigravityUsageWindow {
  usedPercent: number;
  resetsAt: number | null;
  limited: boolean;
}

export type AntigravityUsageWindowName =
  | "geminiRolling"
  | "geminiWeekly"
  | "thirdPartyRolling"
  | "thirdPartyWeekly";

/**
 * Quota windows measured manually via the official `agy -p "/usage"` command.
 * `idle` means no manual check has been triggered yet in this server session.
 */
export interface AntigravityUsage {
  status: "idle" | "ready" | "unavailable";
  windows: Partial<Record<AntigravityUsageWindowName, AntigravityUsageWindow>> | null;
  checkedAt: number;
  message: string | null;
}
