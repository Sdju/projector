import { HttpError } from "../http/index.ts";
import { validatePath } from "./paths.ts";
import { git, gitText } from "./git.ts";
import type {
  CommitComparison,
  GitCommit,
  GitCommitDetail,
  GitCommitFile,
  GitLog,
  GitRef,
} from "../../../core/modules/workspace/index.ts";

const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
const PAGE = 50;
const FIELD = "\x1f";
const logFormat = ["%H", "%P", "%an", "%ae", "%aI", "%D", "%s"].join("%x1f");

function parseRefs(value: string): GitRef[] {
  const refs: GitRef[] = [];
  for (const part of value.split(", ")) {
    if (!part) continue;
    if (part.startsWith("HEAD -> ")) {
      refs.push({ name: "HEAD", kind: "head" }, { name: part.slice(8), kind: "branch" });
    } else if (part === "HEAD") refs.push({ name: "HEAD", kind: "head" });
    else if (part.startsWith("tag: ")) refs.push({ name: part.slice(5), kind: "tag" });
    else refs.push({ name: part, kind: part.includes("/") ? "remote" : "branch" });
  }
  return refs;
}
function parseCommit(row: string, unpushed: Set<string>): GitCommit {
  const [hash = "", parents = "", author = "", email = "", date = "", refs = "", subject = ""] =
    row.split(FIELD);
  return {
    hash,
    parents: parents ? parents.split(" ") : [],
    subject,
    author,
    email,
    date,
    refs: parseRefs(refs),
    unpushed: unpushed.has(hash),
  };
}
async function optional(root: string, args: string[]) {
  return git(root, args).then(
    (value) => value.trim(),
    () => "",
  );
}
async function isRepository(root: string) {
  return git(root, ["rev-parse", "--show-toplevel"]).then(
    () => true,
    () => false,
  );
}

/** A page of history for HEAD, or for all refs; `query` matches the message, or the author with a leading `@`. */
export async function projectLog(
  root: string,
  options: { skip?: number; limit?: number; query?: string; all?: boolean } = {},
): Promise<GitLog> {
  const empty: GitLog = {
    available: false,
    head: "",
    upstream: "",
    ahead: 0,
    behind: 0,
    me: "",
    commits: [],
    next: null,
  };
  if (!(await isRepository(root))) return empty;
  const skip = Math.max(0, Math.floor(options.skip ?? 0));
  const limit = Math.min(200, Math.max(1, Math.floor(options.limit ?? PAGE)));
  const head = await optional(root, ["rev-parse", "--verify", "--quiet", "HEAD"]);
  const [me, upstream] = await Promise.all([
    optional(root, ["config", "user.email"]),
    head ? optional(root, ["rev-parse", "--abbrev-ref", "@{upstream}"]) : "",
  ]);
  const result: GitLog = { ...empty, available: true, head, me, upstream };
  if (!head && !options.all) return result;
  const unpushed = new Set<string>();
  if (upstream) {
    const [ahead, behind] = (
      await optional(root, ["rev-list", "--left-right", "--count", `HEAD...${upstream}`])
    )
      .split(/\s+/)
      .map(Number);
    result.ahead = ahead || 0;
    result.behind = behind || 0;
    for (const hash of (
      await optional(root, ["rev-list", "-n", "2000", `${upstream}..HEAD`])
    ).split("\n"))
      if (hash) unpushed.add(hash);
  }
  const query = options.query?.trim() ?? "";
  const args = [
    "log",
    "-z",
    "--topo-order",
    "--decorate=short",
    `--format=${logFormat}`,
    `--skip=${skip}`,
    `-n${limit + 1}`,
    options.all ? "--all" : "HEAD",
  ];
  // `@name` searches authors, anything else the commit message.
  if (query)
    args.push(
      "--regexp-ignore-case",
      "--fixed-strings",
      query.startsWith("@") ? `--author=${query.slice(1)}` : `--grep=${query}`,
    );
  args.push("--");
  const rows = (await git(root, args)).split("\0").filter(Boolean);
  result.commits = rows.slice(0, limit).map((row) => parseCommit(row.trim(), unpushed));
  result.next = rows.length > limit ? skip + limit : null;
  return result;
}
async function resolveCommit(root: string, hash: string) {
  if (!/^[0-9a-f]{7,40}$/.test(hash)) throw new HttpError(400, "Некорректный хеш коммита");
  const full = await optional(root, ["rev-parse", "--verify", "--quiet", `${hash}^{commit}`]);
  if (!full) throw new HttpError(404, "Коммит не найден");
  return full;
}
function splitNul(value: string) {
  const items = value.split("\0");
  if (items.at(-1) === "") items.pop();
  return items;
}
async function commitFiles(root: string, base: string, hash: string) {
  const range = [base, hash];
  const [names, numbers] = await Promise.all([
    git(root, ["diff", "--name-status", "-z", "-M", "--relative", ...range, "--"]),
    git(root, ["diff", "--numstat", "-z", "-M", "--relative", ...range, "--"]),
  ]);
  const stats = new Map<string, { additions: number; deletions: number; binary: boolean }>();
  const parts = splitNul(numbers);
  for (let i = 0; i < parts.length; i++) {
    const [add = "", del = "", path = ""] = parts[i]!.split("\t");
    // A rename is `add\tdel\t` followed by the old and the new path.
    const target = path || (i += 2, parts[i]!);
    const binary = add === "-";
    stats.set(target, { additions: binary ? 0 : +add, deletions: binary ? 0 : +del, binary });
  }
  const files: GitCommitFile[] = [];
  const items = splitNul(names);
  for (let i = 0; i < items.length; i++) {
    const status = items[i]![0]!;
    const original = status === "R" || status === "C" ? items[++i] : undefined;
    const path = items[++i]!;
    const stat = stats.get(path) ?? { additions: 0, deletions: 0, binary: false };
    files.push({ path, originalPath: original, status, ...stat });
  }
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

/** What a commit changed against its first parent, for the project folder. */
export async function projectCommit(root: string, hash: string): Promise<GitCommitDetail> {
  const full = await resolveCommit(root, hash);
  const meta = await git(root, [
    "show",
    "-s",
    `--format=${["%H", "%P", "%an", "%ae", "%aI", "%D", "%s", "%cn", "%cI", "%b"].join("%x1f")}`,
    full,
  ]);
  const [h = "", parents = "", author = "", email = "", date = "", refs = "", subject = "", cn = "", cd = "", ...body] =
    meta.split(FIELD);
  const parentList = parents ? parents.split(" ") : [];
  const files = await commitFiles(root, parentList[0] ?? EMPTY_TREE, full);
  return {
    hash: h,
    parents: parentList,
    subject,
    author,
    email,
    date,
    refs: parseRefs(refs),
    body: body.join(FIELD).trim(),
    committer: cn,
    committerDate: cd,
    additions: files.reduce((sum, file) => sum + file.additions, 0),
    deletions: files.reduce((sum, file) => sum + file.deletions, 0),
    files,
  };
}

/** Before/after text of one file of a commit, for the diff tab. */
export async function projectCommitComparison(
  root: string,
  hash: string,
  path: string,
): Promise<CommitComparison> {
  validatePath(path);
  const detail = await projectCommit(root, hash);
  const file = detail.files.find((item) => item.path === path);
  if (!file) throw new HttpError(404, "Файл не входит в этот коммит");
  if (file.binary) throw new HttpError(415, "Бинарный файл нельзя сравнить как текст");
  const parent = detail.parents[0];
  const original =
    !parent || file.status === "A" || (file.status === "C" && !file.originalPath)
      ? ""
      : await gitText(root, parent, file.originalPath ?? path);
  const modified = file.status === "D" ? "" : await gitText(root, detail.hash, path);
  return { path, original, modified, hash: detail.hash, parent: parent?.slice(0, 7) ?? "" };
}
