import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { promisify } from "node:util";
import { dataDir } from "../../../core/modules/app-paths/index.ts";

const run = promisify(execFile);
const WORKTREE_ID = /^[0-9a-f]{8}$/;
const IDENTITY = {
  GIT_AUTHOR_NAME: "Projector",
  GIT_AUTHOR_EMAIL: "projector@localhost",
  GIT_COMMITTER_NAME: "Projector",
  GIT_COMMITTER_EMAIL: "projector@localhost",
};

export interface AgentWorktree {
  id: string;
  branch: string;
}

export interface WorktreeStatus extends AgentWorktree {
  /** Files that differ from the project's HEAD when the copy was made. */
  changed: number;
}

const git = async (cwd: string, args: string[], env: NodeJS.ProcessEnv = {}) =>
  (
    await run("git", args, { cwd, env: { ...process.env, ...env }, maxBuffer: 16 * 1024 * 1024 })
  ).stdout.trim();

const gitFailure = (error: unknown): string => {
  const { stderr, message } = error as { stderr?: string; message?: string };
  return (stderr || message || "git завершился с ошибкой").trim();
};

const branchOf = (id: string) => `projector/${id}`;
const folderOf = (projectId: string, id: string) =>
  join(dataDir(), "worktrees", `${projectId}-${id}`);

/** Where a project folder lies inside its repository, so the copy can be entered at the same place. */
async function layout(projectPath: string): Promise<{ root: string; inside: string }> {
  let root: string;
  try {
    root = await git(projectPath, ["rev-parse", "--show-toplevel"]);
  } catch {
    throw new Error("Изолированная копия работает только в git-проекте");
  }
  return { root, inside: relative(root, projectPath) };
}

/** A separate copy of the project (a git worktree on its own branch) for one agent chat to work in. */
export async function createWorktree(
  projectId: string,
  projectPath: string,
): Promise<AgentWorktree & { cwd: string }> {
  const { root, inside } = await layout(projectPath);
  try {
    await git(root, ["rev-parse", "--verify", "-q", "HEAD"]);
  } catch {
    throw new Error(
      "В git-репозитории нет ни одного коммита: сначала сделайте коммит, потом копия",
    );
  }
  const id = randomBytes(4).toString("hex");
  const folder = folderOf(projectId, id);
  await mkdir(join(dataDir(), "worktrees"), { recursive: true, mode: 0o700 });
  try {
    await git(root, ["worktree", "add", "-b", branchOf(id), folder, "HEAD"]);
  } catch (error) {
    throw new Error(`Не удалось создать копию проекта: ${gitFailure(error)}`);
  }
  return { id, branch: branchOf(id), cwd: join(folder, inside) };
}

/** The folder an agent works in for this copy; the identifier comes from a client, so it is checked. */
export async function worktreeCwd(
  projectId: string,
  id: string,
  projectPath: string,
): Promise<string> {
  if (!WORKTREE_ID.test(id)) throw new Error("Некорректная изолированная копия");
  const { inside } = await layout(projectPath);
  const folder = folderOf(projectId, id);
  try {
    await stat(folder);
  } catch {
    throw new Error("Изолированная копия уже удалена");
  }
  return join(folder, inside);
}

export async function worktreeStatus(
  projectId: string,
  id: string,
  projectPath: string,
): Promise<WorktreeStatus> {
  const cwd = await worktreeCwd(projectId, id, projectPath);
  const { root } = await layout(cwd);
  const lines = (await git(root, ["status", "--porcelain"])).split("\n").filter(Boolean);
  const committed = (await git(root, ["diff", "--name-only", "HEAD", branchOf(id)])).split("\n");
  return {
    id,
    branch: branchOf(id),
    changed: new Set([...lines, ...committed.filter(Boolean)]).size,
  };
}

/**
 * Brings the copy's changes into the project: they are committed on the copy's branch and merged
 * into the branch the project is on. A merge that cannot go through is undone and reported.
 */
export async function mergeWorktree(
  projectId: string,
  id: string,
  projectPath: string,
): Promise<{ merged: boolean; message: string }> {
  const cwd = await worktreeCwd(projectId, id, projectPath);
  const copy = (await layout(cwd)).root;
  const main = (await layout(projectPath)).root;
  await git(copy, ["add", "-A"]);
  const dirty = (await git(copy, ["status", "--porcelain"])) !== "";
  if (dirty) await git(copy, ["commit", "-m", "Изменения агента из изолированной копии"], IDENTITY);
  const ahead = Number(await git(main, ["rev-list", "--count", `HEAD..${branchOf(id)}`]));
  if (!ahead) {
    await removeWorktree(projectId, id, projectPath);
    return { merged: false, message: "В копии нет изменений: она удалена" };
  }
  try {
    await git(main, ["merge", "--no-edit", branchOf(id)], IDENTITY);
  } catch (error) {
    await git(main, ["merge", "--abort"]).catch(() => undefined);
    throw new Error(`Слить не удалось, проект не изменён: ${gitFailure(error)}`);
  }
  await removeWorktree(projectId, id, projectPath);
  return { merged: true, message: "Изменения влиты в проект, копия удалена" };
}

/** Deletes the copy and its branch together with everything the agent did in it. */
export async function removeWorktree(
  projectId: string,
  id: string,
  projectPath: string,
): Promise<void> {
  if (!WORKTREE_ID.test(id)) throw new Error("Некорректная изолированная копия");
  const { root } = await layout(projectPath);
  await git(root, ["worktree", "remove", "--force", folderOf(projectId, id)]).catch(
    () => undefined,
  );
  await git(root, ["branch", "-D", branchOf(id)]).catch(() => undefined);
}
