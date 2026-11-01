import { asString } from "../transport/index.ts";
import type { AgentHistoryTurn } from "../providers/index.ts";
import { selectionFrom, type AgentSelection } from "./controls.ts";
import {
  historyFrom,
  planItemsFrom,
  runningToolsFrom,
  type SidePlanItem,
  type SideRunningTool,
} from "./side-request.ts";

const HISTORY_TURNS = 40;
const RUNNING_TOOLS = 12;
const PLAN_ITEMS = 30;
const PHASE_CHARS = 200;
const QUEUE_LIMIT = 99;

/** What Lens knows: the visible chat and the live state the page already holds. */
export interface LensRequest {
  history: AgentHistoryTurn[];
  busy: boolean;
  phase: string;
  running: SideRunningTool[];
  plan: SidePlanItem[];
  queue: number;
  selection: AgentSelection;
}

/** Keep the newest turns for the prompt, starting at a user turn so no answer is orphaned. */
function tail(turns: AgentHistoryTurn[]): AgentHistoryTurn[] {
  const start = Math.max(0, turns.length - HISTORY_TURNS);
  let at = start;
  while (at < turns.length && turns[at]!.role !== "user") at++;
  return turns.slice(at);
}

/** A Lens request from `POST /api/agent/lens`; malformed parts are dropped, sizes bounded. */
export function lensRequestFrom(body: Record<string, unknown>): LensRequest {
  const state =
    body.state && typeof body.state === "object" && !Array.isArray(body.state)
      ? (body.state as Record<string, unknown>)
      : {};
  const queue = state.queue;
  return {
    history: tail(historyFrom(body.history)),
    busy: state.busy === true,
    phase: asString(state.phase).slice(0, PHASE_CHARS),
    running: runningToolsFrom(state.running).slice(0, RUNNING_TOOLS),
    plan: planItemsFrom(state.plan).slice(0, PLAN_ITEMS),
    queue:
      typeof queue === "number" && Number.isFinite(queue) && queue > 0
        ? Math.min(Math.floor(queue), QUEUE_LIMIT)
        : 0,
    selection: selectionFrom(body.selection),
  };
}
