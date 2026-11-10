import {
  normalizeJudgeOverride,
  type JudgeOverride,
} from "@projector-ai/core/modules/agent-judge/index.ts";
import { historyDatabase } from "./history-store.ts";

/** The chat's own Judge settings; absent means the global ones apply. */
export function readChatJudge(chat: string): JudgeOverride | undefined {
  const db = historyDatabase();
  const row = db.prepare("SELECT judge FROM chats WHERE id = ?").get(chat) as
    | { judge: string | null }
    | undefined;
  if (!row?.judge) return undefined;
  try {
    return normalizeJudgeOverride(JSON.parse(row.judge));
  } catch {
    return undefined;
  }
}

/** Replaces the chat's Judge override; `null` returns it to the global settings. */
export function saveChatJudge(chat: string, judge: JudgeOverride | null): void {
  const db = historyDatabase();
  db.prepare(
    `INSERT INTO chats (id, judge) VALUES (?, ?)
     ON CONFLICT (id) DO UPDATE SET judge = excluded.judge`,
  ).run(chat, judge ? JSON.stringify(judge) : null);
}
