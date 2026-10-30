import type { AgentToolChip } from "../model/types.ts";

/** What one answer did to a file, added up over all of its edits. */
export interface FileChange {
  path: string;
  added: number;
  removed: number;
}

const lines = (value: unknown) =>
  typeof value === "string" && value ? value.split("\n").length : 0;

/** Counts only the lines that actually changed between `before` and `after`, not shared context. */
function editLines(before: unknown, after: unknown): { added: number; removed: number } {
  const a = typeof before === "string" && before ? before.split("\n") : [];
  const b = typeof after === "string" && after ? after.split("\n") : [];
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);
  if (!midA.length || !midB.length || midA.length * midB.length > 40_000)
    return { added: midB.length, removed: midA.length };
  const dp = new Uint16Array(midB.length + 1);
  for (let i = 0; i < midA.length; i++) {
    let prev = 0;
    for (let j = 0; j < midB.length; j++) {
      const temp = dp[j + 1]!;
      dp[j + 1] = midA[i] === midB[j] ? prev + 1 : Math.max(temp, dp[j]!);
      prev = temp;
    }
  }
  const common = dp[midB.length]!;
  return { added: midB.length - common, removed: midA.length - common };
}

function parseObject(raw: string | undefined): Record<string, unknown> | undefined {
  if (!raw) return undefined;
  try {
    const data = JSON.parse(raw);
    return data && typeof data === "object" && !Array.isArray(data) ? data : undefined;
  } catch {
    return undefined;
  }
}

/** OpenCode and similar tools report exact diff counts per file in their result metadata. */
function detailFiles(detail: string): { path: string; added: number; removed: number }[] {
  const meta = parseObject(detail)?.metadata;
  const files = meta && typeof meta === "object" ? (meta as { files?: unknown }).files : undefined;
  if (!Array.isArray(files)) return [];
  return files.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const { file, additions, deletions } = entry as Record<string, unknown>;
    if (typeof file !== "string" || typeof additions !== "number" || typeof deletions !== "number")
      return [];
    return [{ path: file, added: additions, removed: deletions }];
  });
}

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
    if (tool.status === "error") continue;
    const reported = detailFiles(tool.detail);
    if (reported.length) {
      for (const item of reported) touch(item.path, item.added, item.removed);
      continue;
    }
    const data = parseObject(tool.input);
    if (!data) continue;
    const name = tool.name.toLowerCase();
    const path = data.file_path ?? data.filePath ?? data.path;
    if (name === "write") touch(path, lines(data.content), 0);
    else if (name === "edit") {
      const { added, removed } = editLines(
        data.old_string ?? data.oldString,
        data.new_string ?? data.newString,
      );
      touch(path, added, removed);
    } else if (name === "multiedit" && Array.isArray(data.edits))
      for (const edit of data.edits as Record<string, unknown>[]) {
        const { added, removed } = editLines(
          edit.old_string ?? edit.oldString,
          edit.new_string ?? edit.newString,
        );
        touch(path, added, removed);
      }
  }
  return [...byPath.values()];
}
