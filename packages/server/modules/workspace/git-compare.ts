import { HttpError } from "../http/index.ts";
import {
  MAX_TEXT_BYTES,
  commitChangeKind,
  isExcludedPath,
  type FileChange,
  type FileChangeList,
  type FileSides,
} from "@ai-projector/core/modules/workspace/index.ts";
import { git, gitText } from "./git.ts";
import { excludePatterns } from "./files-exclude.ts";
import { resolveRevision, validateRelativePath } from "./git-tree.ts";

const MAX_CHANGES = 5000;

async function projectPrefix(root: string) {
  return (await git(root, ["rev-parse", "--show-prefix"])).trim();
}

function relativePath(path: string, prefix: string) {
  if (!prefix) return path;
  return path.startsWith(prefix) ? path.slice(prefix.length) : "";
}

interface ChangeStats {
  additions?: number;
  deletions?: number;
  binary?: boolean;
}

/** `--numstat -z` emits `add\tdel\tpath`, or `add\tdel\t\0old\0new` for a rename. */
function parseNumstat(raw: string) {
  const result = new Map<string, ChangeStats>();
  const tokens = raw.split("\0");
  for (let index = 0; index < tokens.length;) {
    const token = tokens[index++];
    if (!token) continue;
    const [additions = "", deletions = "", inlinePath = ""] = token.split("\t");
    let path = inlinePath;
    if (!path) {
      index++;
      path = tokens[index++] ?? "";
    }
    if (!path) continue;
    const binary = additions === "-" || deletions === "-";
    result.set(
      path,
      binary
        ? { binary: true }
        : { additions: Number(additions) || 0, deletions: Number(deletions) || 0 },
    );
  }
  return result;
}

/**
 * Changed paths of two commits against each other. The answer is a flat list: a comparison has no
 * "deleted node" in a live tree, and the tree view synthesizes folders from these paths.
 */
export async function compareProjectChanges(
  root: string,
  from: string,
  to: string,
): Promise<FileChangeList> {
  const [fromHash, toHash] = await Promise.all([
    resolveRevision(root, from),
    resolveRevision(root, to),
  ]);
  if (fromHash === toHash) return { changes: [], truncated: false };
  const prefix = await projectPrefix(root);
  const [statusRaw, numstatRaw, patterns] = await Promise.all([
    git(root, ["diff", "--name-status", "-z", "-M", fromHash, toHash]),
    git(root, ["diff", "--numstat", "-z", "-M", fromHash, toHash]),
    excludePatterns(),
  ]);
  const stats = parseNumstat(numstatRaw);
  const tokens = statusRaw.split("\0");
  const changes: FileChange[] = [];
  for (let index = 0; index < tokens.length;) {
    const status = tokens[index++];
    if (!status) continue;
    let fromPath = "";
    let toPath = "";
    if (status.startsWith("R") || status.startsWith("C")) {
      fromPath = tokens[index++] ?? "";
      toPath = tokens[index++] ?? "";
    } else toPath = tokens[index++] ?? "";
    const path = relativePath(toPath, prefix);
    if (!path || isExcludedPath(path, patterns)) continue;
    const originalPath =
      fromPath && (status.startsWith("R") || status.startsWith("C"))
        ? relativePath(fromPath, prefix)
        : "";
    const stat = stats.get(toPath) ?? {};
    changes.push({
      path,
      kind: commitChangeKind(status[0] ?? "M"),
      ...(originalPath ? { originalPath } : {}),
      ...stat,
    });
  }
  return { changes: changes.slice(0, MAX_CHANGES), truncated: changes.length > MAX_CHANGES };
}

/**
 * Two text sides of one path between commits. A missing side is an empty string; renames pass the
 * old path separately, because the comparison list knows it.
 */
export async function compareProjectFile(
  root: string,
  from: string,
  to: string,
  path: string,
  originalPath = path,
): Promise<FileSides> {
  validateRelativePath(path);
  validateRelativePath(originalPath);
  if (!path) throw new HttpError(400, "Выберите файл");
  const [fromHash, toHash] = await Promise.all([
    resolveRevision(root, from),
    resolveRevision(root, to),
  ]);
  const prefix = await projectPrefix(root);
  const read = async (hash: string, file: string) => {
    const spec = `${hash}:${prefix}${file}`;
    const type = (await git(root, ["cat-file", "-t", spec]).catch(() => "")).trim();
    if (!type) return "";
    if (type !== "blob") throw new HttpError(400, "Выберите файл");
    const size = Number((await git(root, ["cat-file", "-s", spec])).trim());
    if (!Number.isSafeInteger(size) || size < 0)
      throw new HttpError(404, "Файл не найден в этом снимке");
    if (size > MAX_TEXT_BYTES)
      throw new HttpError(
        413,
        `Файл больше ${MAX_TEXT_BYTES / 1024 / 1024} МБ: редактор не сможет его открыть`,
      );
    return gitText(root, hash, file);
  };
  const [original, modified] = await Promise.all([
    read(fromHash, originalPath),
    read(toHash, path),
  ]);
  if (!original && !modified) throw new HttpError(404, "Файл не найден в этом сравнении");
  return { path, original, modified };
}
