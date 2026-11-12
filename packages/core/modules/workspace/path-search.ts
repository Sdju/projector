export interface ProjectPath {
  path: string;
  directory: boolean;
}

/**
 * Lower is better, `undefined` is no match: the query must appear in order (a subsequence), and
 * a hit in the file name, or a tight one, beats a hit scattered over the folders.
 */
function score(path: string, query: string): number | undefined {
  const lower = path.replaceAll("\\", "/").toLowerCase();
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

/** Files and folders whose path matches `query`, best first. An empty query is the top-level entries. */
export function rankPaths(paths: readonly ProjectPath[], query: string, limit = 30): ProjectPath[] {
  const text = query.trim().toLowerCase();
  if (!text)
    return paths
      .filter((item) => !item.path.replaceAll("\\", "/").includes("/"))
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
