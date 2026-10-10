import { execFile, spawn } from "node:child_process";
import { mkdtemp, rm, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { RewindResult } from "./backend.ts";

const run = promisify(execFile);
const MESSAGE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REF_ROOT = "refs/projector/snapshots";
/** Snapshots kept per repository; older ones are dropped as new ones are taken. */
const KEEP = 100;
/** Snapshots are made by Projector, not by a person: they need no configured identity. */
const IDENTITY = {
  GIT_AUTHOR_NAME: "Projector",
  GIT_AUTHOR_EMAIL: "projector@localhost",
  GIT_COMMITTER_NAME: "Projector",
  GIT_COMMITTER_EMAIL: "projector@localhost",
};

async function git(cwd: string, args: string[], env: NodeJS.ProcessEnv = {}): Promise<string> {
  const { stdout } = await run("git", args, {
    cwd,
    env: { ...process.env, ...env },
    maxBuffer: 64 * 1024 * 1024,
  });
  return stdout.trim();
}

/** Writes the working tree (tracked and untracked, ignored files left out) as a git tree. */
async function treeOfWorkingFiles(root: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "projector-snapshot-"));
  const env = { GIT_INDEX_FILE: join(dir, "index") };
  try {
    await git(root, ["read-tree", "HEAD"], env).catch(() => undefined);
    await git(root, ["add", "-A", "--", "."], env);
    return await git(root, ["write-tree"], env);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function repositoryRoot(cwd: string): Promise<string | undefined> {
  try {
    return await git(cwd, ["rev-parse", "--show-toplevel"]);
  } catch {
    return undefined;
  }
}

/**
 * Keeps how the project's files were before a message, for agents that cannot take their own
 * changes back. The snapshot is a commit under a private ref: no branch, index or working file
 * of the user is touched. A folder that is not a git repository gets none.
 */
export async function snapshotProject(cwd: string, messageId: string): Promise<boolean> {
  if (!MESSAGE_ID.test(messageId)) return false;
  const root = await repositoryRoot(cwd);
  if (!root) return false;
  const tree = await treeOfWorkingFiles(root);
  const parent = await git(root, ["rev-parse", "-q", "--verify", "HEAD"]).catch(() => "");
  const commit = await git(
    root,
    ["commit-tree", tree, ...(parent ? ["-p", parent] : []), "-m", `snapshot ${messageId}`],
    IDENTITY,
  );
  await git(root, ["update-ref", `${REF_ROOT}/${messageId}`, commit]);
  const refs = (
    await git(root, ["for-each-ref", "--sort=-creatordate", "--format=%(refname)", REF_ROOT])
  )
    .split("\n")
    .filter(Boolean);
  for (const ref of refs.slice(KEEP)) await git(root, ["update-ref", "-d", ref]).catch(() => {});
  return true;
}

/** Runs git with a NUL-separated list of paths on stdin. */
function gitWithPaths(root: string, args: string[], paths: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, { cwd: root, stdio: ["pipe", "ignore", "pipe"] });
    let error = "";
    child.stderr.on("data", (chunk) => (error += chunk));
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(error.trim() || "git завершился с ошибкой")),
    );
    child.stdin.end(paths.join("\0"));
  });
}

/** Puts the files back to the snapshot taken before the message; `dryRun` only lists them. */
export async function rewindToSnapshot(
  cwd: string,
  messageId: string,
  dryRun: boolean,
): Promise<RewindResult> {
  const none = (error: string): RewindResult => ({ ok: false, error, files: [] });
  if (!MESSAGE_ID.test(messageId)) return none("Некорректный шаг для отката");
  const root = await repositoryRoot(cwd);
  if (!root) return none("Проект не в git: снимков файлов нет");
  const ref = `${REF_ROOT}/${messageId}`;
  const snapshot = await git(root, ["rev-parse", "-q", "--verify", `${ref}^{tree}`]).catch(
    () => "",
  );
  if (!snapshot) return none("Снимка файлов перед этим сообщением нет");
  const current = await treeOfWorkingFiles(root);
  const changes = (await git(root, ["diff-tree", "-r", "--name-status", "-z", snapshot, current]))
    .split("\0")
    .filter(Boolean);
  // Name-status with -z alternates a status and a path.
  const restore: string[] = [];
  const remove: string[] = [];
  for (let at = 0; at + 1 < changes.length; at += 2)
    (changes[at] === "A" ? remove : restore).push(changes[at + 1]!);
  const numstat = await git(root, ["diff-tree", "-r", "--numstat", current, snapshot]);
  let insertions = 0;
  let deletions = 0;
  for (const line of numstat.split("\n").filter(Boolean)) {
    const [added, removed] = line.split("\t");
    insertions += Number(added) || 0;
    deletions += Number(removed) || 0;
  }
  const files = [...restore, ...remove].map((path) => join(root, path));
  if (!dryRun) {
    if (restore.length)
      await gitWithPaths(
        root,
        [
          "restore",
          `--source=${ref}`,
          "--worktree",
          "--pathspec-from-file=-",
          "--pathspec-file-nul",
        ],
        restore,
      );
    for (const path of remove) await unlink(join(root, path)).catch(() => {});
  }
  return { ok: true, files, insertions, deletions };
}
