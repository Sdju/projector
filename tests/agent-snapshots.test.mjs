import { expect, test } from "vite-plus/test";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, realpath, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rewindToSnapshot, snapshotProject } from "../server/modules/agent/snapshots.ts";

const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
const ID = "11111111-2222-3333-4444-555555555555";

async function repo() {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "projector-snap-")));
  git(dir, "init", "-q");
  git(dir, "config", "user.email", "t@t");
  git(dir, "config", "user.name", "t");
  await writeFile(join(dir, ".gitignore"), "ignored.log\n");
  await writeFile(join(dir, "a.txt"), "one\n");
  await writeFile(join(dir, "b.txt"), "keep\n");
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", "init");
  return dir;
}

test("files go back to the snapshot: edits, deletions and files the agent added", async () => {
  const dir = await repo();
  try {
    await writeFile(join(dir, "wip.txt"), "uncommitted\n");
    expect(await snapshotProject(dir, ID)).toBe(true);
    const head = git(dir, "rev-parse", "HEAD");
    const status = git(dir, "status", "--porcelain");

    await writeFile(join(dir, "a.txt"), "two\nthree\n");
    await rm(join(dir, "b.txt"));
    await mkdir(join(dir, "sub"));
    await writeFile(join(dir, "sub", "new.txt"), "x\n");
    await writeFile(join(dir, "ignored.log"), "noise\n");

    const preview = await rewindToSnapshot(dir, ID, true);
    expect(preview.ok).toBe(true);
    expect(preview.files.map((file) => file.slice(dir.length + 1)).sort()).toEqual([
      "a.txt",
      "b.txt",
      "sub/new.txt",
    ]);
    expect(await readFile(join(dir, "a.txt"), "utf8")).toBe("two\nthree\n");

    const done = await rewindToSnapshot(dir, ID, false);
    expect(done.ok).toBe(true);
    expect(await readFile(join(dir, "a.txt"), "utf8")).toBe("one\n");
    expect(await readFile(join(dir, "b.txt"), "utf8")).toBe("keep\n");
    expect(existsSync(join(dir, "sub", "new.txt"))).toBe(false);
    // What was not the agent's stays: the user's uncommitted file and ignored files.
    expect(await readFile(join(dir, "wip.txt"), "utf8")).toBe("uncommitted\n");
    expect(existsSync(join(dir, "ignored.log"))).toBe(true);
    // The repository itself is untouched: same HEAD, same status as before the run.
    expect(git(dir, "rev-parse", "HEAD")).toBe(head);
    expect(git(dir, "status", "--porcelain")).toBe(status);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("no snapshot outside git, and a missing one is reported", async () => {
  const plain = await realpath(await mkdtemp(join(tmpdir(), "projector-snap-plain-")));
  const dir = await repo();
  try {
    expect(await snapshotProject(plain, ID)).toBe(false);
    expect((await rewindToSnapshot(plain, ID, true)).ok).toBe(false);
    const missing = await rewindToSnapshot(dir, "99999999-2222-3333-4444-555555555555", true);
    expect(missing.ok).toBe(false);
    expect(await snapshotProject(dir, "../../etc")).toBe(false);
  } finally {
    await rm(plain, { recursive: true, force: true });
    await rm(dir, { recursive: true, force: true });
  }
});
