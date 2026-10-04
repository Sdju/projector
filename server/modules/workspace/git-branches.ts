import { realpath } from "node:fs/promises";
import { HttpError } from "../http/index.ts";
import { git, serializeGitWrite } from "./git.ts";
import type { GitBranch, GitBranches } from "../../../core/modules/workspace/index.ts";

const FIELD = "\x1f";
const refFormat = [
  "%(HEAD)",
  "%(refname)",
  "%(refname:short)",
  "%(upstream:short)",
  "%(upstream:track,nobracket)",
  "%(objectname:short)",
  "%(committerdate:iso-strict)",
  "%(contents:subject)",
].join("%1f");

async function optional(root: string, args: string[]) {
  return git(root, args).then(
    (value) => value.trim(),
    () => "",
  );
}
/** Git's own words are the most useful explanation, e.g. which files block a checkout. */
async function run(root: string, args: string[]) {
  try {
    return await git(root, args);
  } catch (error) {
    const text = String((error as { stderr?: string }).stderr ?? (error as Error).message);
    const lines = text
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    throw new HttpError(409, lines.slice(0, 4).join("\n") || "Операция Git не выполнена");
  }
}

export async function projectBranches(root: string): Promise<GitBranches> {
  const empty: GitBranches = { available: false, current: "", detached: false, branches: [] };
  if (
    await git(root, ["rev-parse", "--show-toplevel"]).then(
      () => false,
      () => true,
    )
  )
    return empty;
  const [rows, merged, symbolic, short] = await Promise.all([
    optional(root, [
      "for-each-ref",
      `--format=${refFormat}`,
      "--sort=-committerdate",
      "refs/heads",
      "refs/remotes",
    ]),
    optional(root, ["for-each-ref", "--merged=HEAD", "--format=%(refname:short)", "refs/heads"]),
    optional(root, ["symbolic-ref", "--short", "-q", "HEAD"]),
    optional(root, ["rev-parse", "--short", "HEAD"]),
  ]);
  const mergedNames = new Set(merged.split("\n").filter(Boolean));
  const branches: GitBranch[] = [];
  for (const row of rows.split("\n")) {
    if (!row) continue;
    const [
      head = "",
      ref = "",
      name = "",
      upstream = "",
      track = "",
      hash = "",
      date = "",
      subject = "",
    ] = row.split(FIELD);
    if (ref.endsWith("/HEAD")) continue;
    const local = ref.startsWith("refs/heads/");
    branches.push({
      name,
      kind: local ? "local" : "remote",
      current: head === "*",
      upstream,
      gone: track === "gone",
      ahead: Number(/ahead (\d+)/.exec(track)?.[1] ?? 0),
      behind: Number(/behind (\d+)/.exec(track)?.[1] ?? 0),
      merged: local && mergedNames.has(name),
      hash,
      subject,
      date,
    });
  }
  // Current branch first, then local branches, then remote ones; each by recency.
  const rank = (branch: GitBranch) => (branch.current ? 0 : branch.kind === "local" ? 1 : 2);
  branches.sort((a, b) => rank(a) - rank(b));
  return { available: true, current: symbolic || short, detached: !symbolic, branches };
}

export interface BranchInput {
  name?: string;
  newName?: string;
  from?: string;
  checkout?: boolean;
  force?: boolean;
}
async function validName(root: string, name: unknown) {
  if (typeof name !== "string" || !name.trim()) throw new HttpError(400, "Укажите имя ветки");
  const valid = await git(root, ["check-ref-format", "--branch", name]).then(
    () => true,
    () => false,
  );
  if (!valid || name === "HEAD") throw new HttpError(400, `Недопустимое имя ветки: ${name}`);
  return name;
}

/** Branch operations; names are resolved against the real branch list, never passed through blindly. */
export async function mutateProjectBranch(
  root: string,
  action: string,
  input: BranchInput,
): Promise<GitBranches> {
  if (!["checkout", "create", "rename", "delete"].includes(action))
    throw new HttpError(400, "Неизвестное действие с веткой");
  const base = await realpath(root);
  return serializeGitWrite(base, async () => {
    const current = await projectBranches(base);
    if (!current.available) throw new HttpError(404, "Здесь нет Git-репозитория");
    const find = (name: unknown, kind?: GitBranch["kind"]) =>
      current.branches.find((branch) => branch.name === name && (!kind || branch.kind === kind));
    if (action === "create") {
      const name = await validName(base, input.name);
      if (find(name, "local")) throw new HttpError(409, `Ветка ${name} уже существует`);
      let from = "HEAD";
      if (input.from) {
        if (!find(input.from) && !/^[0-9a-f]{7,40}$/.test(input.from))
          throw new HttpError(400, "Начало ветки: укажите ветку или хеш коммита");
        from = input.from;
        if (!(await optional(base, ["rev-parse", "--verify", "--quiet", `${from}^{commit}`])))
          throw new HttpError(404, "Коммит не найден");
      }
      if (!(await optional(base, ["rev-parse", "--verify", "--quiet", "HEAD"])))
        throw new HttpError(409, "Сначала создайте первый коммит");
      await run(
        base,
        input.checkout === false ? ["branch", name, from] : ["switch", "-c", name, from],
      );
    } else {
      const branch = find(input.name);
      if (!branch) throw new HttpError(404, "Ветка не найдена. Обновите список.");
      if (action === "checkout") {
        if (branch.current) return current;
        if (branch.kind === "local") await run(base, ["switch", branch.name]);
        else {
          const local = branch.name.slice(branch.name.indexOf("/") + 1);
          if (find(local, "local")) await run(base, ["switch", local]);
          else await run(base, ["switch", "--track", branch.name]);
        }
      } else if (branch.kind !== "local") {
        throw new HttpError(409, "Ветки удалённого репозитория не изменяются");
      } else if (action === "rename") {
        const newName = await validName(base, input.newName);
        if (find(newName, "local")) throw new HttpError(409, `Ветка ${newName} уже существует`);
        await run(base, ["branch", "-m", branch.name, newName]);
      } else {
        if (branch.current) throw new HttpError(409, "Нельзя удалить текущую ветку");
        if (!branch.merged && !input.force)
          throw new HttpError(409, `Ветка ${branch.name} не слита в текущую`);
        await run(base, ["branch", "-D", branch.name]);
      }
    }
    return projectBranches(base);
  });
}
