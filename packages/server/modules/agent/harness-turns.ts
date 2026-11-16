import type { AgentTask } from "@ai-projector/core/modules/agent-task/index.ts";

/** A turn that may carry harness reminders Kimi/Claude inject into the transcript. */
export type HarnessTurn = {
  role?: string;
  text?: string;
  tasks?: AgentTask[];
  variants?: HarnessTurn[][];
};

const REMINDER = /<system-reminder>[\s\S]*?<\/system-reminder>/gi;

/** Text with every harness block removed. */
export function withoutHarness(text: string): string {
  return text.replace(REMINDER, "").trim();
}

/** A user line that is only agent harness noise (todo nudge, lost background tasks, …). */
export function isHarnessOnly(text: string): boolean {
  return !withoutHarness(text) && /<system-reminder>/i.test(text);
}

/** Agents Kimi listed as lost after the user left: `agent_id` resume key and title. */
export function lostBackgroundAgents(
  text: string,
): { resume: string; title: string; taskId?: string }[] {
  if (!/background tasks from the previous session lost contact/i.test(text)) return [];
  const out: { resume: string; title: string; taskId?: string }[] = [];
  for (const match of text.matchAll(
    /-\s*(agent-[a-z0-9]+)\s+"([^"]+)"\s*\(subagent\)\s*—\s*resume it with Agent\(resume="(agent-\d+)"/gi,
  )) {
    out.push({ taskId: match[1], title: match[2]!, resume: match[3]! });
  }
  return out;
}

/**
 * Drops harness-only user turns and marks matching background tasks stopped when Kimi reports
 * they lost contact. Returns whether anything changed.
 */
export function sanitizeHarnessTurns(turns: HarnessTurn[], at = Date.now()): boolean {
  let changed = false;
  const kept: HarnessTurn[] = [];
  for (const turn of turns) {
    const text = turn.text ?? "";
    if (turn.role === "user" && /<system-reminder>/i.test(text)) {
      const lost = lostBackgroundAgents(text);
      if (lost.length) markLostTasks(kept, lost, at);
      if (isHarnessOnly(text)) {
        changed = true;
        continue;
      }
      const cleaned = withoutHarness(text);
      if (cleaned !== text.trim()) {
        turn.text = cleaned;
        changed = true;
      }
      if (!cleaned) {
        changed = true;
        continue;
      }
      kept.push(turn);
      continue;
    }
    kept.push(turn);
  }
  if (kept.length !== turns.length) {
    turns.splice(0, turns.length, ...kept);
    changed = true;
  }
  return changed;
}

function markLostTasks(
  turns: HarnessTurn[],
  lost: { resume: string; title: string; taskId?: string }[],
  at: number,
) {
  const byResume = new Map(lost.map((item) => [item.resume, item]));
  const byTitle = new Map(lost.map((item) => [item.title, item]));
  const byTaskId = new Map(lost.filter((item) => item.taskId).map((item) => [item.taskId!, item]));
  for (const turn of turns) {
    for (const task of turn.tasks ?? []) {
      if (task.status !== "running") continue;
      const hit =
        (task.session && byResume.get(task.session)) ||
        (task.session && byTaskId.get(task.session)) ||
        byTitle.get(task.title);
      if (!hit) continue;
      task.status = "stopped";
      task.endedAt ??= at;
      task.summary ??= "Фоновая задача потеряла связь после выхода из приложения";
    }
  }
}
