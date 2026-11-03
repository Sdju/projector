/**
 * Where a file is read from. The value is serializable: tabs, sidebar sections and caches keep it
 * as data, while the provider decides how to serve it. A revision is always a concrete hash, so an
 * open tab cannot move when a branch changes.
 */
export type FileScope =
  | { kind: "live" }
  | { kind: "commit"; rev: string }
  | { kind: "compare"; from: string; to: string };

/** A stable key for tabs, sessions and directory caches. */
export function fileScopeKey(scope: FileScope): string {
  if (scope.kind === "live") return "live";
  if (scope.kind === "commit") return `commit:${scope.rev}`;
  return `compare:${scope.from}..${scope.to}`;
}

/** Parameters every read of this scope carries; the action itself stays at the call site. */
export function fileScopeQuery(scope: FileScope): Record<string, string> {
  if (scope.kind === "live") return {};
  if (scope.kind === "commit") return { rev: scope.rev };
  return { from: scope.from, to: scope.to };
}

export const isLiveScope = (scope: FileScope) => scope.kind === "live";

export const shortRevision = (rev: string) => rev.slice(0, 7);

/** Sidebar section title: what the tree shows, not how it is read. */
export function fileScopeTitle(scope: FileScope): string {
  if (scope.kind === "live") return "Файлы проекта";
  if (scope.kind === "commit") return `Файлы коммита @${shortRevision(scope.rev)}`;
  return `Сравнение ${shortRevision(scope.from)}..${shortRevision(scope.to)}`;
}

/** Note above a read-only tree. Empty for the working copy. */
export function fileScopeNote(scope: FileScope): string {
  if (scope.kind === "live") return "";
  if (scope.kind === "commit") return `Только чтение · коммит ${shortRevision(scope.rev)}`;
  return `Только чтение · ${shortRevision(scope.from)}..${shortRevision(scope.to)}`;
}
