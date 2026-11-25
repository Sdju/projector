import { realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { HttpError } from "../../http/index.ts";

export interface TrajectoryProjectScope {
  cwd: string;
  worktrees: { root: string; prefix: string };
}

interface StoredSession {
  directory: string | null;
  title?: unknown;
  model?: unknown;
}

function canonicalPath(path: string): string {
  let canonical: string;
  try {
    canonical = realpathSync.native(path);
  } catch (error) {
    // The transcript can outlive a deleted worktree.
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    canonical = resolve(path);
  }
  return process.platform === "win32" ? canonical.toLowerCase() : canonical;
}

function belongsToProject(directory: string | null, scope: TrajectoryProjectScope): boolean {
  if (!directory || !isAbsolute(directory)) return false;
  const cwd = canonicalPath(directory);
  if (cwd === canonicalPath(scope.cwd)) return true;
  const inside = relative(canonicalPath(scope.worktrees.root), cwd);
  const folder = inside.split(sep)[0] ?? "";
  const prefix =
    process.platform === "win32" ? scope.worktrees.prefix.toLowerCase() : scope.worktrees.prefix;
  return folder.startsWith(prefix) && /^[0-9a-f]{8}$/.test(folder.slice(prefix.length));
}

export function openTrajectorySession(
  db: DatabaseSync,
  id: string,
  scope: TrajectoryProjectScope,
): { cwd: string; modern: boolean; session: StoredSession } {
  const tables = db
    .prepare(
      "SELECT name FROM sqlite_schema WHERE type = 'table' AND name IN ('session_v2', 'session', 'session_message')",
    )
    .all();
  const has = (name: string) => tables.some((table) => table.name === name);
  const current = has("session_v2")
    ? (db.prepare("SELECT directory, title, model FROM session_v2 WHERE id = ?").get(id) as
        | StoredSession
        | undefined)
    : undefined;
  const session =
    current ??
    (has("session")
      ? (db.prepare("SELECT directory FROM session WHERE id = ?").get(id) as
          | StoredSession
          | undefined)
      : undefined);
  if (!session?.directory || !belongsToProject(session.directory, scope))
    throw new HttpError(404, "Сессия OpenCode не найдена в этом проекте");
  return { cwd: session.directory, modern: Boolean(current) && has("session_message"), session };
}
