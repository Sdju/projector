import { randomUUID } from "node:crypto";
import {
  chatMetaOf,
  chatTitle,
  deleteHistory,
  historyDatabase,
  loadHistory,
  saveHistory,
} from "./history-store.ts";
import { readAgentHistory, writeAgentHistory } from "./history.ts";

/** A chat put aside when the user started another one; `scope` is the chat it was the live one of. */
export interface ArchivedChat {
  id: string;
  title: string;
  updatedAt: string;
  pinned: boolean;
}

/** Most chats kept per scope; the oldest unpinned ones go first. */
const KEEP = 100;
const archiveKey = (id: string) => `archive:${id}`;

interface Row {
  id: string;
  title: string;
  updated: string;
  pinned: number;
}

export function listArchivedChats(scope: string): ArchivedChat[] {
  const rows = historyDatabase()
    .prepare(
      "SELECT id, title, updated, pinned FROM archives WHERE scope = ? ORDER BY pinned DESC, updated DESC",
    )
    .all(scope) as unknown as Row[];
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    updatedAt: row.updated,
    pinned: row.pinned === 1,
  }));
}

/** Puts the live chat of `scope` aside and empties it; nothing happens to an empty chat. */
export async function archiveLiveChat(scope: string): Promise<string | undefined> {
  const turns = await readAgentHistory(scope);
  if (!turns.length) return undefined;
  const id = randomUUID();
  const db = historyDatabase();
  const meta = chatMetaOf(scope);
  saveHistory(archiveKey(id), turns);
  db.prepare(
    "INSERT INTO archives (id, scope, title, updated, pinned, project, backend) VALUES (?, ?, ?, ?, 0, ?, ?)",
  ).run(
    id,
    scope,
    meta?.title || chatTitle(turns),
    new Date().toISOString(),
    meta?.project ?? "",
    meta?.backend ?? "",
  );
  const extra = db
    .prepare(
      "SELECT id FROM archives WHERE scope = ? AND pinned = 0 ORDER BY updated DESC LIMIT -1 OFFSET ?",
    )
    .all(scope, KEEP) as unknown as { id: string }[];
  for (const row of extra) removeArchivedChat(row.id);
  // The live chat is empty now: it should not linger in the project's list of chats.
  await writeAgentHistory(scope, [], meta);
  return id;
}

/** Makes an archived chat the live one (the one that was live is put aside) and returns it. */
export async function openArchivedChat(scope: string, id: string) {
  const row = historyDatabase()
    .prepare("SELECT id, title, project, backend FROM archives WHERE id = ? AND scope = ?")
    .get(id, scope) as { id: string; title: string; project: string; backend: string } | undefined;
  const turns = row ? loadHistory(archiveKey(id)) : undefined;
  if (!row || !turns) throw new Error("Чат не найден");
  await archiveLiveChat(scope);
  removeArchivedChat(id);
  const index =
    row.project && row.backend
      ? { project: row.project, backend: row.backend, title: row.title }
      : undefined;
  return writeAgentHistory(scope, turns, index);
}

export function renameArchivedChat(id: string, change: { title?: string; pinned?: boolean }) {
  const db = historyDatabase();
  if (change.title !== undefined) {
    const title = change.title.trim().slice(0, 200);
    if (!title) throw new Error("Название не может быть пустым");
    db.prepare("UPDATE archives SET title = ? WHERE id = ?").run(title, id);
  }
  if (change.pinned !== undefined)
    db.prepare("UPDATE archives SET pinned = ? WHERE id = ?").run(change.pinned ? 1 : 0, id);
}

export function removeArchivedChat(id: string): void {
  historyDatabase().prepare("DELETE FROM archives WHERE id = ?").run(id);
  deleteHistory(archiveKey(id));
}
