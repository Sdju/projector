import type { JudgeVerdict } from "../../../../core/modules/agent-judge/index.ts";

/** A CSS suffix for the risk tint, shared by the card and its large score box. */
export function permissionRiskClass(judge?: JudgeVerdict): string {
  return judge ? `risk-${judge.score}` : "risk-0";
}

/** Card tone by the judge's score; without a verdict the card keeps the old warning style. */
export function permissionTone(judge?: JudgeVerdict): "neutral" | "warning" | "danger" {
  if (!judge) return "warning";
  if (judge.score >= 4) return "danger";
  if (judge.score === 3) return "warning";
  return "neutral";
}

/** A remembered permission must never make a high-risk action permanently silent. */
export function canRememberPermission(permission: {
  persistent: boolean;
  judge?: JudgeVerdict;
}): boolean {
  return permission.persistent && (!permission.judge || permission.judge.score < 4);
}
