import assert from "node:assert/strict";
import { test } from "node:test";
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
    assert.equal(empty.available, true);
    assert.deepEqual(empty.commits, []);
    assert.equal((await projectLog(plain)).available, false);
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
    assert.deepEqual(
      page.commits.map((commit) => commit.subject),
      ["commit 3", "commit 2"],
    );
    assert.equal(page.next, 2);
    assert.equal(page.me, "history@example.test");
    assert.deepEqual(page.commits[0].refs, [
      { name: "HEAD", kind: "head" },
      { name: "main", kind: "branch" },
    ]);
    assert.deepEqual(page.commits[0].parents, [page.commits[1].hash]);
    const rest = await projectLog(base, { skip: 2, limit: 2 });
    assert.equal(rest.commits.length, 1);
    assert.equal(rest.next, null);
    assert.deepEqual(rest.commits[0].refs, [{ name: "v1", kind: "tag" }]);
    assert.deepEqual(rest.commits[0].parents, []);
    assert.equal(
      page.commits.every((commit) => !commit.unpushed),
      true,
    );

    assert.deepEqual(
      (await projectLog(base, { query: "COMMIT 2" })).commits.map((commit) => commit.subject),
      ["commit 2"],
    );
    assert.equal((await projectLog(base, { query: "@History" })).commits.length, 3);
    assert.equal((await projectLog(base, { query: "@nobody" })).commits.length, 0);

    // Upstream is another local repository, so ahead/behind and unpushed marks are testable.
    const remote = await mkdtemp(join(tmpdir(), "projector-remote-"));
    try {
      execFileSync("git", ["init", "-q", "--bare", "-b", "main", remote]);
      run("remote", "add", "origin", remote);
      run("push", "-q", "-u", "origin", "main");
      await writeFile(join(base, "a.txt"), "4\n");
      run("commit", "-qam", "local only");
      const log = await projectLog(base);
      assert.equal(log.upstream, "origin/main");
      assert.equal(log.ahead, 1);
      assert.equal(log.behind, 0);
      assert.deepEqual(
        log.commits.map((commit) => commit.unpushed),
        [true, false, false, false],
      );
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
    assert.deepEqual(
      initial.files.map((file) => [file.path, file.status]),
      [
        ["root.txt", "A"],
        ["sub/gone.txt", "A"],
        ["sub/keep.txt", "A"],
      ],
    );
    assert.deepEqual(initial.parents, []);

    const detail = await projectCommit(base, second.slice(0, 10));
    assert.equal(detail.subject, "second");
    assert.equal(detail.body, "details of second");
    assert.equal(detail.committer, "History Test");
    assert.deepEqual(
      detail.files.map((file) => [file.path, file.status, file.originalPath]),
      [
        ["root.txt", "M", undefined],
        ["sub/keep.txt", "M", undefined],
        ["sub/moved.txt", "R", "sub/gone.txt"],
        ["sub/new.txt", "A", undefined],
      ],
    );
    assert.equal(detail.additions, 4);
    assert.equal(detail.deletions, 2);

    const scoped = await projectCommit(join(base, "sub"), second);
    assert.deepEqual(
      scoped.files.map((file) => file.path),
      ["keep.txt", "moved.txt", "new.txt"],
    );

    const diff = await projectCommitComparison(base, second, "sub/keep.txt");
    assert.equal(diff.original, "one\ntwo\n");
    assert.equal(diff.modified, "one\nchanged\nthree\n");
    assert.equal(diff.parent, first.slice(0, 7));
    const renamed = await projectCommitComparison(base, second, "sub/moved.txt");
    assert.equal(renamed.original, "gone\n");
    assert.equal((await projectCommitComparison(base, second, "sub/new.txt")).original, "");
    assert.equal((await projectCommitComparison(base, first, "root.txt")).parent, "");
    await assert.rejects(projectCommitComparison(base, second, "sub/gone.txt"), { status: 404 });
    await assert.rejects(projectCommitComparison(base, second, "../x"), { status: 403 });
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
      await assert.rejects(projectCommit(base, hash), { status: 400 });
    await assert.rejects(projectCommit(base, "0123456789abcdef"), { status: 404 });
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});
