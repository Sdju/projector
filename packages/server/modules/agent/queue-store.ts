import { historyDatabase } from "./history-store.ts";

/** A message waiting for the answer in progress to end, as it is kept with the chat. */
export interface StoredQueueMessage {
  id: string;
  text: string;
  parts: unknown[];
  form?: unknown;
  auto?: string;
  autoTitle?: string;
}

/** The messages waiting for the answer, saved with the chat; absent for a chat without a queue. */
export function readChatQueue(chat: string): StoredQueueMessage[] | undefined {
  const row = historyDatabase().prepare("SELECT queue FROM chats WHERE id = ?").get(chat) as
    | { queue: string | null }
    | undefined;
  if (!row?.queue) return undefined;
  try {
    const value = JSON.parse(row.queue) as unknown;
    return Array.isArray(value) ? (value as StoredQueueMessage[]) : undefined;
  } catch {
    return undefined;
  }
}

/** Replaces the messages waiting for the answer; an empty queue is stored as none at all. */
export function saveChatQueue(chat: string, queue: StoredQueueMessage[] | null): void {
  historyDatabase()
    .prepare(
      `INSERT INTO chats (id, queue) VALUES (?, ?)
       ON CONFLICT (id) DO UPDATE SET queue = excluded.queue`,
    )
    .run(chat, queue?.length ? JSON.stringify(queue) : null);
}
