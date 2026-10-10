import { realpath } from "node:fs/promises";
import { os } from "../../../core/modules/os/index.ts";
import { HttpError } from "../http/index.ts";
import { MAX_BYTES, excludePatterns } from "./paths.ts";

export interface ProjectPath {
  path: string;
  directory: boolean;
}

const CACHE_MS = 5000;
const MAX_PATHS = 50000;
const cache = new Map<string, { at: number; paths: ProjectPath[] }>();

/** Every file of the project (what `rg --files` shows, honouring ignores) and its folders. */
async function listPaths(root: string): Promise<ProjectPath[]> {
  const base = await realpath(root);
  const cached = cache.get(base);
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.paths;
  const args = ["--files", "--hidden", "--no-require-git"];
  for (const pattern of await excludePatterns()) {
    args.push("--glob", `!${pattern}`);
    if (!pattern.endsWith("/**")) args.push("--glob", `!${pattern}/**`);
  }
  let output = "";
  try {
    output = (
      await os.tools.searchFiles(args, { cwd: base, maxBuffer: 16 * MAX_BYTES, timeout: 10000 })
    ).stdout;
  } catch (error) {
    const failure = error as { code?: number | string; stdout?: string };
    if (failure.code === "ENOENT") throw new HttpError(503, "Для поиска нужен ripgrep (rg)");
    // rg exits 1 for "nothing found" and 2 for partial errors; the partial list is still useful.
    output = failure.stdout ?? "";
  }
  const files = output.split("\n").filter(Boolean).slice(0, MAX_PATHS);
  const folders = new Set<string>();
  for (const file of files) {
    const parts = file.split("/");
    for (let end = 1; end < parts.length; end++) folders.add(parts.slice(0, end).join("/"));
  }
  const paths = [
    ...[...folders].map((path) => ({ path, directory: true })),
    ...files.map((path) => ({ path, directory: false })),
  ];
  cache.set(base, { at: Date.now(), paths });
  return paths;
}

/**
 * Lower is better, `undefined` is no match: the query must appear in order (a subsequence), and
 * a hit in the file name, or a tight one, beats a hit scattered over the folders.
 */
function score(path: string, query: string): number | undefined {
  const lower = path.toLowerCase();
  const name = lower.slice(lower.lastIndexOf("/") + 1);
  const exact = name.indexOf(query);
  if (exact === 0) return path.length * 0.01;
  if (exact > 0) return 1 + exact + path.length * 0.01;
  const whole = lower.indexOf(query);
  if (whole >= 0) return 50 + whole + path.length * 0.01;
  let at = -1;
  let gaps = 0;
  for (const letter of query) {
    const next = lower.indexOf(letter, at + 1);
    if (next < 0) return undefined;
    gaps += at < 0 ? 0 : next - at - 1;
    at = next;
  }
  return 100 + gaps + path.length * 0.01;
}

/** Files and folders of a project whose path matches `query`, best first. */
export async function findProjectPaths(root: string, query: string, limit = 30) {
  const text = query.trim().toLowerCase();
  if (text.length > 200) throw new HttpError(400, "Запрос длиннее 200 символов");
  const paths = await listPaths(root);
  if (!text)
    return paths
      .filter((item) => !item.path.includes("/"))
      .sort((a, b) => Number(b.directory) - Number(a.directory) || a.path.localeCompare(b.path))
      .slice(0, limit);
  const ranked: { item: ProjectPath; value: number }[] = [];
  for (const item of paths) {
    const value = score(item.path, text);
    if (value !== undefined) ranked.push({ item, value });
  }
  return ranked
    .sort((a, b) => a.value - b.value)
    .slice(0, limit)
    .map(({ item }) => item);
}
