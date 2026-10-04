import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { projectBranches, mutateProjectBranch } from "../server/modules/workspace/index.ts";

async function repository() {
  const base = await mkdtemp(join(tmpdir(), "projector-branches-"));
  const run = (...args) => execFileSync("git", ["-C", base, ...args], { encoding: "utf8" });
  run("init", "-q", "-b", "main");
  run("config", "user.name", "Branch Test");
  run("config", "user.email", "branch@example.test");
  return { base, run };
}
const commit = async (base, run, file, text, message) => {
  await writeFile(join(base, file), text);
  run("add", ".");
  run("commit", "-qm", message);
};
const names = (list, kind) =>
  list.branches.filter((branch) => branch.kind === kind).map((branch) => branch.name);

test("branch list of a non-repository and of an empty repository", async () => {
  const plain = await mkdtemp(join(tmpdir(), "projector-nogit-"));
  const { base } = await repository();
  try {
    assert.equal((await projectBranches(plain)).available, false);
    const empty = await projectBranches(base);
    assert.equal(empty.available, true);
    assert.deepEqual(empty.branches, []);
    await assert.rejects(mutateProjectBranch(base, "create", { name: "x" }), { status: 409 });
  } finally {
    await rm(plain, { recursive: true, force: true });
    await rm(base, { recursive: true, force: true });
  }
});

test("create, switch, rename and delete local branches", async () => {
  const { base, run } = await repository();
  try {
    await commit(base, run, "a.txt", "a\n", "one");
    let list = await projectBranches(base);
    assert.equal(list.current, "main");
    assert.equal(list.detached, false);
    assert.equal(list.branches[0].current, true);
    assert.equal(list.branches[0].subject, "one");

    list = await mutateProjectBranch(base, "create", { name: "feature/x" });
    assert.equal(list.current, "feature/x");
    await commit(base, run, "b.txt", "b\n", "two");

    // Unmerged branch needs force; the current one is protected.
    list = await mutateProjectBranch(base, "checkout", { name: "main" });
    assert.equal(list.current, "main");
    const feature = list.branches.find((branch) => branch.name === "feature/x");
    assert.equal(feature.merged, false);
    await assert.rejects(mutateProjectBranch(base, "delete", { name: "feature/x" }), {
      status: 409,
    });
    await assert.rejects(mutateProjectBranch(base, "delete", { name: "main", force: true }), {
      status: 409,
    });

    list = await mutateProjectBranch(base, "create", { name: "side", checkout: false });
    assert.equal(list.current, "main");
    assert.equal(list.branches.find((branch) => branch.name === "side").merged, true);
    list = await mutateProjectBranch(base, "rename", { name: "side", newName: "renamed" });
    assert.deepEqual(names(list, "local").sort(), ["feature/x", "main", "renamed"]);
    list = await mutateProjectBranch(base, "delete", { name: "renamed" });
    assert.equal(names(list, "local").includes("renamed"), false);
    list = await mutateProjectBranch(base, "delete", { name: "feature/x", force: true });
    assert.deepEqual(names(list, "local"), ["main"]);

    // Branching from an explicit start point.
    const first = run("rev-parse", "HEAD").trim();
    list = await mutateProjectBranch(base, "create", {
      name: "from-hash",
      from: first.slice(0, 8),
    });
    assert.equal(list.current, "from-hash");
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("branch names and start points are validated", async () => {
  const { base, run } = await repository();
  try {
    await commit(base, run, "a.txt", "a\n", "one");
    for (const name of ["", "-x", "a b", "a..b", "HEAD", "x.lock", "~y"])
      await assert.rejects(mutateProjectBranch(base, "create", { name }), { status: 400 });
    await assert.rejects(mutateProjectBranch(base, "create", { name: "ok", from: "--help" }), {
      status: 400,
    });
    await assert.rejects(mutateProjectBranch(base, "create", { name: "main" }), { status: 409 });
    await assert.rejects(mutateProjectBranch(base, "checkout", { name: "nope" }), { status: 404 });
    await assert.rejects(mutateProjectBranch(base, "frobnicate", { name: "main" }), {
      status: 400,
    });
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("a dirty tree that blocks checkout is reported with Git's explanation", async () => {
  const { base, run } = await repository();
  try {
    await commit(base, run, "a.txt", "base\n", "one");
    await mutateProjectBranch(base, "create", { name: "other" });
    await commit(base, run, "a.txt", "other\n", "other change");
    await mutateProjectBranch(base, "checkout", { name: "main" });
    await writeFile(join(base, "a.txt"), "local edit\n");
    await assert.rejects(mutateProjectBranch(base, "checkout", { name: "other" }), (error) => {
      assert.equal(error.status, 409);
      assert.match(error.message, /a\.txt/);
      return true;
    });
    assert.equal((await projectBranches(base)).current, "main");
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("remote branches track upstream state and check out as local tracking branches", async () => {
  const { base, run } = await repository();
  const remote = await mkdtemp(join(tmpdir(), "projector-branches-remote-"));
  try {
    execFileSync("git", ["init", "-q", "--bare", "-b", "main", remote]);
    await commit(base, run, "a.txt", "a\n", "one");
    run("remote", "add", "origin", remote);
    run("push", "-q", "-u", "origin", "main");
    run("switch", "-q", "-c", "topic");
    await commit(base, run, "t.txt", "t\n", "topic work");
    run("push", "-q", "origin", "topic");
    run("switch", "-q", "main");
    run("branch", "-q", "-D", "topic");
    run("fetch", "-q", "origin");
    await commit(base, run, "b.txt", "b\n", "ahead");

    let list = await projectBranches(base);
    const main = list.branches.find((branch) => branch.name === "main");
    assert.equal(main.upstream, "origin/main");
    assert.equal(main.ahead, 1);
    assert.equal(main.behind, 0);
    assert.deepEqual(names(list, "remote").sort(), ["origin/main", "origin/topic"]);
    assert.equal(
      list.branches.some((branch) => branch.name.endsWith("/HEAD")),
      false,
    );

    list = await mutateProjectBranch(base, "checkout", { name: "origin/topic" });
    assert.equal(list.current, "topic");
    assert.equal(list.branches.find((branch) => branch.name === "topic").upstream, "origin/topic");
    // The local branch already exists now, so it is reused.
    await mutateProjectBranch(base, "checkout", { name: "main" });
    assert.equal(
      (await mutateProjectBranch(base, "checkout", { name: "origin/topic" })).current,
      "topic",
    );
    await assert.rejects(mutateProjectBranch(base, "delete", { name: "origin/topic" }), {
      status: 409,
    });
  } finally {
    await rm(remote, { recursive: true, force: true });
    await rm(base, { recursive: true, force: true });
  }
});
