import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { chmod, readFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { dataDir } from "../../../core/modules/app-paths/index.ts";

/** A turn as the chat shows it: the versions of the conversation hang off the user turn that starts them. */
export interface HistoryTurn {
  id: string;
  variants?: HistoryTurn[][];
  slot?: number;
}

const ROOT = "";

/**
 * Every turn of every version of a chat is a row: `parent` is the turn it follows, so a fork is
 * several rows with one parent. `pick` on the parent (or on `chats` for the first message) is the
 * child the chat currently shows; without it the newest child is shown.
 */
const SCHEMA = `
  CREATE TABLE IF NOT EXISTS chats (
    id TEXT PRIMARY KEY,
    pick TEXT,
    revision INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS turns (
    chat TEXT NOT NULL,
    id TEXT NOT NULL,
    parent TEXT NOT NULL,
    ord INTEGER NOT NULL,
    pick TEXT,
    hash TEXT NOT NULL,
    data TEXT NOT NULL,
    PRIMARY KEY (chat, id)
  );
  CREATE INDEX IF NOT EXISTS turns_parent ON turns (chat, parent, ord);
`;

const databases = new Map<string, DatabaseSync>();

function database(): DatabaseSync {
  const directory = join(dataDir(), "agent");
  const file = join(directory, "history.sqlite");
  const open = databases.get(file);
  if (open) return open;
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA synchronous = NORMAL;");
  db.exec(SCHEMA);
  void chmod(file, 0o600).catch(() => {});
  databases.set(file, db);
  return db;
}

/** Closes every opened database (a test removing its data directory, a restart). */
export function closeHistoryStore() {
  for (const db of databases.values()) db.close();
  databases.clear();
}

interface Row {
  id: string;
  parent: string;
  ord: number;
  pick: string | null;
  hash: string;
  data: string;
}

const hashOf = (text: string) => createHash("sha1").update(text).digest("base64");

/** Splits a version of the chat into rows; forks found along the way become sibling rows. */
function flatten(
  turns: HistoryTurn[],
  parent: string,
  rows: Row[],
  pick: Map<string, string>,
  /** Place of the first turn among the turns that follow `parent`. */
  place = 0,
) {
  let previous = parent;
  for (let index = 0; index < turns.length; index++) {
    const head = turns[index]!;
    if (head.variants?.length) {
      const position = Math.min(head.slot ?? head.variants.length, head.variants.length);
      const versions = [...head.variants];
      versions.splice(position, 0, turns.slice(index));
      versions.forEach((version, ord) => {
        if (!version.length) return;
        const [first, ...rest] = version;
        const alone = { ...first!, variants: undefined, slot: undefined };
        flatten([alone, ...rest], previous, rows, pick, ord);
      });
      const shown = versions[position]?.[0];
      if (shown) pick.set(previous, shown.id);
      return;
    }
    rows.push(rowOf(head, previous, index === 0 ? place : 0));
    previous = head.id;
  }
}

function rowOf(turn: HistoryTurn, parent: string, ord: number): Row {
  const { variants: _variants, slot: _slot, ...rest } = turn;
  const data = JSON.stringify(rest);
  return { id: turn.id, parent, ord, pick: null, hash: hashOf(`${parent}\n${ord}\n${data}`), data };
}

/** Replaces the saved chat with `turns`, rewriting only the rows that changed. */
export function saveHistory(chat: string, turns: HistoryTurn[]): void {
  const rows: Row[] = [];
  const pick = new Map<string, string>();
  flatten(turns, ROOT, rows, pick);
  const seen = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.id)) throw new Error(`Повторяющийся ID сообщения: ${row.id}`);
    seen.add(row.id);
  }
  const db = database();
  db.exec("BEGIN IMMEDIATE");
  try {
    const existing = new Map<string, { hash: string; pick: string | null }>();
    for (const row of db
      .prepare("SELECT id, hash, pick FROM turns WHERE chat = ?")
      .all(chat) as unknown as Row[])
      existing.set(row.id, { hash: row.hash, pick: row.pick });
    const upsert = db.prepare(
      `INSERT INTO turns (chat, id, parent, ord, pick, hash, data) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (chat, id) DO UPDATE SET
         parent = excluded.parent, ord = excluded.ord, pick = excluded.pick,
         hash = excluded.hash, data = excluded.data`,
    );
    for (const row of rows) {
      const choice = pick.get(row.id) ?? null;
      const before = existing.get(row.id);
      existing.delete(row.id);
      if (before && before.hash === row.hash && before.pick === choice) continue;
      upsert.run(chat, row.id, row.parent, row.ord, choice, row.hash, row.data);
    }
    const remove = db.prepare("DELETE FROM turns WHERE chat = ? AND id = ?");
    for (const id of existing.keys()) remove.run(chat, id);
    db.prepare(
      `INSERT INTO chats (id, pick, revision) VALUES (?, ?, 1)
       ON CONFLICT (id) DO UPDATE SET pick = excluded.pick, revision = revision + 1`,
    ).run(chat, pick.get(ROOT) ?? null);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

/** The chat as it is shown: the picked version, the others nested under the turn that forks them. */
export function loadHistory(chat: string): HistoryTurn[] | undefined {
  const db = database();
  const meta = db.prepare("SELECT pick FROM chats WHERE id = ?").get(chat) as
    | { pick: string | null }
    | undefined;
  if (!meta) return undefined;
  const rows = db
    .prepare("SELECT id, parent, ord, pick, data FROM turns WHERE chat = ? ORDER BY parent, ord")
    .all(chat) as unknown as Row[];
  const children = new Map<string, Row[]>();
  for (const row of rows) {
    const list = children.get(row.parent);
    if (list) list.push(row);
    else children.set(row.parent, [row]);
  }
  const pickOf = new Map(rows.map((row) => [row.id, row.pick]));
  pickOf.set(ROOT, meta.pick);

  /** One version: follows single children, and nests the others where the chat forks. */
  function chain(first: Row): HistoryTurn[] {
    const out: HistoryTurn[] = [];
    const visited = new Set<string>();
    let row: Row | undefined = first;
    while (row && !visited.has(row.id)) {
      visited.add(row.id);
      const turn = JSON.parse(row.data) as HistoryTurn;
      out.push(turn);
      const next: Row[] = children.get(row.id) ?? [];
      if (next.length > 1) {
        fork(row.id, next, out);
        return out;
      }
      row = next[0];
    }
    return out;
  }

  /** Appends the shown version of the siblings under `parent`, with the other versions nested in its first turn. */
  function fork(parent: string, siblings: Row[], out: HistoryTurn[]) {
    const picked = pickOf.get(parent);
    const index = Math.max(
      0,
      siblings.findIndex((item) => item.id === picked),
    );
    const slot =
      picked && siblings.some((item) => item.id === picked) ? index : siblings.length - 1;
    const versions = siblings.map((item) => chain(item));
    const shown = versions[slot]!;
    shown[0]!.variants = versions.filter((_, at) => at !== slot);
    shown[0]!.slot = slot;
    out.push(...shown);
  }

  const top = children.get(ROOT) ?? [];
  if (!top.length) return [];
  if (top.length === 1) return chain(top[0]!);
  const out: HistoryTurn[] = [];
  fork(ROOT, top, out);
  return out;
}

/** How many saved versions of a chat exist, for diagnostics and tests. */
export function historyRevision(chat: string): number {
  const row = database().prepare("SELECT revision FROM chats WHERE id = ?").get(chat) as
    | { revision: number }
    | undefined;
  return row?.revision ?? 0;
}

export function deleteHistory(chat: string): void {
  const db = database();
  db.prepare("DELETE FROM turns WHERE chat = ?").run(chat);
  db.prepare("DELETE FROM chats WHERE id = ?").run(chat);
}

/** The JSON file an earlier version kept a chat in. */
export function legacyHistoryPath(chat: string): string {
  return join(dataDir(), "agent", `${createHash("sha256").update(chat).digest("hex")}.json`);
}

/** Moves the chat of an older version out of its JSON file into the database, once. */
export async function importLegacyHistory(
  chat: string,
  parse: (value: unknown) => HistoryTurn[],
): Promise<HistoryTurn[] | undefined> {
  const path = legacyHistoryPath(chat);
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  const turns = parse(JSON.parse(raw));
  saveHistory(chat, turns);
  await rename(path, `${path}.bak`);
  return turns;
}
