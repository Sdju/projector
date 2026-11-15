import type { AgentTask } from "@ai-projector/core/modules/agent-task/index.ts";
import { openCodeIdleOutcomes } from "./sessions.ts";

/** A chat turn that may still list OpenCode background tasks as `running`. */
export type OpenCodeHistoryTurn = {
  tasks?: AgentTask[];
  run?: string;
  variants?: OpenCodeHistoryTurn[][];
};

/**
 * Clears background tasks that OpenCode already finished (`idle_outcome` / suspended) but that the
 * chat still shows as `running` — ACP never got the completion notify, and a reload only reads
 * history. Returns whether any turn changed (caller should save).
 */
export function settleOpenCodeHistoryTasks(
  turns: OpenCodeHistoryTurn[],
  at = Date.now(),
  idleOutcomes: typeof openCodeIdleOutcomes = openCodeIdleOutcomes,
): boolean {
  const sessions: string[] = [];
  const collect = (list: OpenCodeHistoryTurn[]) => {
    for (const turn of list) {
      for (const task of turn.tasks ?? [])
        if (task.status === "running" && typeof task.session === "string")
          sessions.push(task.session);
      for (const version of turn.variants ?? []) collect(version);
    }
  };
  collect(turns);
  if (!sessions.length) return false;
  const outcomes = idleOutcomes(sessions);
  if (!outcomes.size) return false;
  let changed = false;
  const apply = (list: OpenCodeHistoryTurn[]) => {
    for (const turn of list) {
      for (const task of turn.tasks ?? []) {
        if (task.status !== "running" || typeof task.session !== "string") continue;
        const status = outcomes.get(task.session);
        if (!status) continue;
        task.status = status;
        task.endedAt ??= at;
        changed = true;
      }
      if (
        turn.run &&
        !(turn.tasks ?? []).some(
          (task) =>
            task.status === "running" && task.background === true && task.untracked !== true,
        )
      ) {
        delete turn.run;
        changed = true;
      }
      for (const version of turn.variants ?? []) apply(version);
    }
  };
  apply(turns);
  return changed;
}
