import { expect, test } from "vite-plus/test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import {
  projectLog,
  projectCommit,
  projectCommitComparison,
} from "../server/modules/workspace/index.ts";

async function repository() {
  const base = await mkdtemp(join(tmpdir(), "projector-history-"));
  const run = (...args) => execFileSync("git", ["-C", base, ...args], { encoding: "utf8" });
  run("init", "-q", "-b", "main");
  run("config", "user.name", "History Test");
  run("config", "user.email", "history@example.test");
  return { base, run };
}

test("log of an empty repository and of a folder without Git", async () => {
  const { base } = await repository();
  const plain = await mkdtemp(join(tmpdir(), "projector-nogit-"));
  try {
    const empty = await projectLog(base);
    expect(empty.available).toBe(true);
    expect(empty.commits).toStrictEqual([]);
    expect((await projectLog(plain)).available).toBe(false);
  } finally {
    await rm(base, { recursive: true, force: true });
    await rm(plain, { recursive: true, force: true });
  }
});

test("log pages commits with refs, parents and unpushed marks", async () => {
  const { base, run } = await repository();
  try {
    for (const n of [1, 2, 3]) {
      await writeFile(join(base, "a.txt"), `${n}\n`);
      run("add", ".");
      run("commit", "-qm", `commit ${n}\n\nbody ${n}`);
    }
    run("tag", "v1", "HEAD~2");
    const page = await projectLog(base, { limit: 2 });
    expect(page.commits.map((commit) => commit.subject)).toStrictEqual(["commit 3", "commit 2"]);
    expect(page.next).toBe(2);
    expect(page.me).toBe("history@example.test");
    expect(page.commits[0].refs).toStrictEqual([
      { name: "HEAD", kind: "head" },
      { name: "main", kind: "branch" },
    ]);
    expect(page.commits[0].parents).toStrictEqual([page.commits[1].hash]);
    const rest = await projectLog(base, { skip: 2, limit: 2 });
    expect(rest.commits.length).toBe(1);
    expect(rest.next).toBe(null);
    expect(rest.commits[0].refs).toStrictEqual([{ name: "v1", kind: "tag" }]);
    expect(rest.commits[0].parents).toStrictEqual([]);
    expect(page.commits.every((commit) => !commit.unpushed)).toBe(true);

    expect(
      (await projectLog(base, { query: "COMMIT 2" })).commits.map((commit) => commit.subject),
    ).toStrictEqual(["commit 2"]);
    expect((await projectLog(base, { query: "@History" })).commits.length).toBe(3);
    expect((await projectLog(base, { query: "@nobody" })).commits.length).toBe(0);

    // Upstream is another local repository, so ahead/behind and unpushed marks are testable.
    const remote = await mkdtemp(join(tmpdir(), "projector-remote-"));
    try {
      execFileSync("git", ["init", "-q", "--bare", "-b", "main", remote]);
      run("remote", "add", "origin", remote);
      run("push", "-q", "-u", "origin", "main");
      await writeFile(join(base, "a.txt"), "4\n");
      run("commit", "-qam", "local only");
      const log = await projectLog(base);
      expect(log.upstream).toBe("origin/main");
      expect(log.ahead).toBe(1);
      expect(log.behind).toBe(0);
      expect(log.commits.map((commit) => commit.unpushed)).toStrictEqual([
        true,
        false,
        false,
        false,
      ]);
    } finally {
      await rm(remote, { recursive: true, force: true });
    }
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("commit detail lists files against the first parent, limited to the folder", async () => {
  const { base, run } = await repository();
  try {
    await mkdir(join(base, "sub"));
    await writeFile(join(base, "root.txt"), "root\n");
    await writeFile(join(base, "sub", "keep.txt"), "one\ntwo\n");
    await writeFile(join(base, "sub", "gone.txt"), "gone\n");
    run("add", ".");
    run("commit", "-qm", "initial");
    const first = run("rev-parse", "HEAD").trim();
    await writeFile(join(base, "sub", "keep.txt"), "one\nchanged\nthree\n");
    run("mv", "sub/gone.txt", "sub/moved.txt");
    await writeFile(join(base, "sub", "new.txt"), "new\n");
    await writeFile(join(base, "root.txt"), "changed root\n");
    run("rm", "-q", "--cached", "root.txt");
    run("add", ".");
    run("commit", "-q", "-m", "second", "-m", "details of second");
    const second = run("rev-parse", "HEAD").trim();

    const initial = await projectCommit(base, first);
    expect(initial.files.map((file) => [file.path, file.status])).toStrictEqual([
      ["root.txt", "A"],
      ["sub/gone.txt", "A"],
      ["sub/keep.txt", "A"],
    ]);
    expect(initial.parents).toStrictEqual([]);

    const detail = await projectCommit(base, second.slice(0, 10));
    expect(detail.subject).toBe("second");
    expect(detail.body).toBe("details of second");
    expect(detail.committer).toBe("History Test");
    expect(detail.files.map((file) => [file.path, file.status, file.originalPath])).toStrictEqual([
      ["root.txt", "M", undefined],
      ["sub/keep.txt", "M", undefined],
      ["sub/moved.txt", "R", "sub/gone.txt"],
      ["sub/new.txt", "A", undefined],
    ]);
    expect(detail.additions).toBe(4);
    expect(detail.deletions).toBe(2);

    const scoped = await projectCommit(join(base, "sub"), second);
    expect(scoped.files.map((file) => file.path)).toStrictEqual([
      "keep.txt",
      "moved.txt",
      "new.txt",
    ]);

    const diff = await projectCommitComparison(base, second, "sub/keep.txt");
    expect(diff.original).toBe("one\ntwo\n");
    expect(diff.modified).toBe("one\nchanged\nthree\n");
    expect(diff.parent).toBe(first.slice(0, 7));
    const renamed = await projectCommitComparison(base, second, "sub/moved.txt");
    expect(renamed.original).toBe("gone\n");
    expect((await projectCommitComparison(base, second, "sub/new.txt")).original).toBe("");
    expect((await projectCommitComparison(base, first, "root.txt")).parent).toBe("");
    await expect(projectCommitComparison(base, second, "sub/gone.txt")).rejects.toMatchObject({
      status: 404,
    });
    await expect(projectCommitComparison(base, second, "../x")).rejects.toMatchObject({
      status: 403,
    });
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("commit lookups reject malformed and unknown hashes", async () => {
  const { base, run } = await repository();
  try {
    await writeFile(join(base, "a.txt"), "a\n");
    run("add", ".");
    run("commit", "-qm", "one");
    for (const hash of ["", "--help", "HEAD", "zzzzzzz", "abc"])
      await expect(projectCommit(base, hash)).rejects.toMatchObject({ status: 400 });
    await expect(projectCommit(base, "0123456789abcdef")).rejects.toMatchObject({ status: 404 });
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});
