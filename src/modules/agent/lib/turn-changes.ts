import type { AgentToolChip } from "../model/types.ts";

/** What one answer did to a file, added up over all of its edits. */
export interface FileChange {
  path: string;
  added: number;
  removed: number;
}

const lines = (value: unknown) =>
  typeof value === "string" && value ? value.split("\n").length : 0;

/** The files an answer wrote or edited, with the lines added and removed; failed calls are skipped. */
export function turnChanges(tools: AgentToolChip[], root = ""): FileChange[] {
  const byPath = new Map<string, FileChange>();
  const touch = (rawPath: unknown, added: number, removed: number) => {
    if (typeof rawPath !== "string" || !rawPath) return;
    const path = root && rawPath.startsWith(`${root}/`) ? rawPath.slice(root.length + 1) : rawPath;
    const change = byPath.get(path) ?? { path, added: 0, removed: 0 };
    change.added += added;
    change.removed += removed;
    byPath.set(path, change);
  };
  for (const tool of tools) {
    if (tool.status === "error" || !tool.input) continue;
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(tool.input);
    } catch {
      continue;
    }
    if (!data || typeof data !== "object") continue;
    const name = tool.name.toLowerCase();
    const path = data.file_path ?? data.path;
    if (name === "write") touch(path, lines(data.content), 0);
    else if (name === "edit") touch(path, lines(data.new_string), lines(data.old_string));
    else if (name === "multiedit" && Array.isArray(data.edits))
      for (const edit of data.edits as { old_string?: unknown; new_string?: unknown }[])
        touch(path, lines(edit.new_string), lines(edit.old_string));
  }
  return [...byPath.values()];
}
