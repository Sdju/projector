import { expect, test } from "vite-plus/test";
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
    expect((await projectBranches(plain)).available).toBe(false);
    const empty = await projectBranches(base);
    expect(empty.available).toBe(true);
    expect(empty.branches).toStrictEqual([]);
    await expect(mutateProjectBranch(base, "create", { name: "x" })).rejects.toMatchObject({
      status: 409,
    });
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
    expect(list.current).toBe("main");
    expect(list.detached).toBe(false);
    expect(list.branches[0].current).toBe(true);
    expect(list.branches[0].subject).toBe("one");

    list = await mutateProjectBranch(base, "create", { name: "feature/x" });
    expect(list.current).toBe("feature/x");
    await commit(base, run, "b.txt", "b\n", "two");

    // Unmerged branch needs force; the current one is protected.
    list = await mutateProjectBranch(base, "checkout", { name: "main" });
    expect(list.current).toBe("main");
    const feature = list.branches.find((branch) => branch.name === "feature/x");
    expect(feature.merged).toBe(false);
    await expect(mutateProjectBranch(base, "delete", { name: "feature/x" })).rejects.toMatchObject({
      status: 409,
    });
    await expect(
      mutateProjectBranch(base, "delete", { name: "main", force: true }),
    ).rejects.toMatchObject({
      status: 409,
    });

    list = await mutateProjectBranch(base, "create", { name: "side", checkout: false });
    expect(list.current).toBe("main");
    expect(list.branches.find((branch) => branch.name === "side").merged).toBe(true);
    list = await mutateProjectBranch(base, "rename", { name: "side", newName: "renamed" });
    expect(names(list, "local").sort()).toStrictEqual(["feature/x", "main", "renamed"]);
    list = await mutateProjectBranch(base, "delete", { name: "renamed" });
    expect(names(list, "local").includes("renamed")).toBe(false);
    list = await mutateProjectBranch(base, "delete", { name: "feature/x", force: true });
    expect(names(list, "local")).toStrictEqual(["main"]);

    // Branching from an explicit start point.
    const first = run("rev-parse", "HEAD").trim();
    list = await mutateProjectBranch(base, "create", {
      name: "from-hash",
      from: first.slice(0, 8),
    });
    expect(list.current).toBe("from-hash");
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("branch names and start points are validated", async () => {
  const { base, run } = await repository();
  try {
    await commit(base, run, "a.txt", "a\n", "one");
    for (const name of ["", "-x", "a b", "a..b", "HEAD", "x.lock", "~y"])
      await expect(mutateProjectBranch(base, "create", { name })).rejects.toMatchObject({
        status: 400,
      });
    await expect(
      mutateProjectBranch(base, "create", { name: "ok", from: "--help" }),
    ).rejects.toMatchObject({
      status: 400,
    });
    await expect(mutateProjectBranch(base, "create", { name: "main" })).rejects.toMatchObject({
      status: 409,
    });
    await expect(mutateProjectBranch(base, "checkout", { name: "nope" })).rejects.toMatchObject({
      status: 404,
    });
    await expect(mutateProjectBranch(base, "frobnicate", { name: "main" })).rejects.toMatchObject({
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
    await expect(mutateProjectBranch(base, "checkout", { name: "other" })).rejects.toSatisfy(
      (error) => {
        expect(error.status).toBe(409);
        expect(error.message).toMatch(/a\.txt/);
        return true;
      },
    );
    expect((await projectBranches(base)).current).toBe("main");
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
    expect(main.upstream).toBe("origin/main");
    expect(main.ahead).toBe(1);
    expect(main.behind).toBe(0);
    expect(names(list, "remote").sort()).toStrictEqual(["origin/main", "origin/topic"]);
    expect(list.branches.some((branch) => branch.name.endsWith("/HEAD"))).toBe(false);

    list = await mutateProjectBranch(base, "checkout", { name: "origin/topic" });
    expect(list.current).toBe("topic");
    expect(list.branches.find((branch) => branch.name === "topic").upstream).toBe("origin/topic");
    // The local branch already exists now, so it is reused.
    await mutateProjectBranch(base, "checkout", { name: "main" });
    expect((await mutateProjectBranch(base, "checkout", { name: "origin/topic" })).current).toBe(
      "topic",
    );
    await expect(
      mutateProjectBranch(base, "delete", { name: "origin/topic" }),
    ).rejects.toMatchObject({
      status: 409,
    });
  } finally {
    await rm(remote, { recursive: true, force: true });
    await rm(base, { recursive: true, force: true });
  }
});
