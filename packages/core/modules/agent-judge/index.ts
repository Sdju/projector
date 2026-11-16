/** How dangerous an action looks to Projector Judge; 1 is harmless, 5 threatens the system. */
export type JudgeScore = 1 | 2 | 3 | 4 | 5;

export type JudgeConfidence = "high" | "medium" | "low";

/** A verdict about one concrete action, shown in the permission card. */
export interface JudgeVerdict {
  score: JudgeScore;
  label: string;
  reason: string;
  confidence: JudgeConfidence;
  /** What exactly changes, when the action makes it clear. */
  effect?: string;
}

/** How an action was resolved: by Judge itself or by the user after the card. */
export type JudgeDecision = "auto" | "allowed" | "always" | "denied";

/** The judge settings that apply to a chat after the global value and its override are merged. */
export interface JudgeSettings {
  /** Show the score and the explanation in the permission card. */
  show: boolean;
  /** Allow actions at or below `maxRisk` unless the judge is unsure. */
  auto: boolean;
  /** The highest score that may run unasked; 4 and 5 are never automatic. */
  maxRisk: 1 | 2 | 3;
  /** Which confidence levels are enough for an automatic decision. */
  confidence: "high" | "high-medium";
}

/** What one chat changes about the global settings; absent fields keep the global value. */
export type JudgeOverride = Partial<JudgeSettings>;

export const JUDGE_DEFAULTS: JudgeSettings = {
  show: true,
  auto: true,
  maxRisk: 1,
  confidence: "high-medium",
};

const LABELS: Record<JudgeScore, string> = {
  1: "безопасно",
  2: "низкий",
  3: "умеренный",
  4: "высокий",
  5: "критический",
};

const TONES: Record<JudgeScore, "info" | "neutral" | "warning" | "danger"> = {
  1: "info",
  2: "neutral",
  3: "warning",
  4: "danger",
  5: "danger",
};

const DECISIONS: Record<JudgeDecision, string> = {
  auto: "Разрешено автоматически",
  allowed: "Разрешено вами",
  always: "Разрешено вами навсегда",
  denied: "Отклонено вами",
};

export function judgeScoreLabel(score: JudgeScore): string {
  return LABELS[score];
}

/** How the action ended, in the words of the chat. */
export function judgeDecisionLabel(decision: JudgeDecision): string {
  return DECISIONS[decision];
}

export function judgeScoreTone(score: JudgeScore): "info" | "neutral" | "warning" | "danger" {
  return TONES[score];
}

export function isJudgeScore(value: unknown): value is JudgeScore {
  return value === 1 || value === 2 || value === 3 || value === 4 || value === 5;
}

export function isJudgeVerdict(value: unknown): value is JudgeVerdict {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return (
    isJudgeScore(row.score) &&
    typeof row.label === "string" &&
    typeof row.reason === "string" &&
    (row.confidence === "high" || row.confidence === "medium" || row.confidence === "low") &&
    (row.effect === undefined || typeof row.effect === "string")
  );
}

/** The settings a request should use: the chat's override over the global value. */
export function resolveJudgeSettings(
  global: JudgeSettings,
  override: JudgeOverride | undefined,
): JudgeSettings {
  return normalizeJudgeSettings(override, global);
}

/** Validates a stored or requested value; anything wrong keeps the base value. */
export function normalizeJudgeSettings(
  value: unknown,
  base: JudgeSettings = JUDGE_DEFAULTS,
): JudgeSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ...base };
  const row = value as Record<string, unknown>;
  return {
    show: typeof row.show === "boolean" ? row.show : base.show,
    auto: typeof row.auto === "boolean" ? row.auto : base.auto,
    maxRisk:
      row.maxRisk === 1 || row.maxRisk === 2 || row.maxRisk === 3 ? row.maxRisk : base.maxRisk,
    confidence:
      row.confidence === "high" || row.confidence === "high-medium"
        ? row.confidence
        : base.confidence,
  };
}

/** Only the fields a chat really overrides, so a reset can drop them. */
export function normalizeJudgeOverride(value: unknown): JudgeOverride | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const row = value as Record<string, unknown>;
  const result: JudgeOverride = {};
  if (typeof row.show === "boolean") result.show = row.show;
  if (typeof row.auto === "boolean") result.auto = row.auto;
  if (row.maxRisk === 1 || row.maxRisk === 2 || row.maxRisk === 3) result.maxRisk = row.maxRisk;
  if (row.confidence === "high" || row.confidence === "high-medium")
    result.confidence = row.confidence;
  return Object.keys(result).length ? result : undefined;
}

/** Whether a verdict may be allowed without the user, given the resolved settings. */
export function judgeAllows(settings: JudgeSettings, verdict: JudgeVerdict): boolean {
  if (!settings.auto) return false;
  if (verdict.score > settings.maxRisk) return false;
  return settings.confidence === "high-medium"
    ? verdict.confidence === "high" || verdict.confidence === "medium"
    : verdict.confidence === "high";
}
