import { expect, test } from "vite-plus/test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { mutateProjectSync, projectBranches } from "../modules/workspace/index.ts";

async function repository(prefix = "projector-sync-") {
  const base = await mkdtemp(join(tmpdir(), prefix));
  const run = (...args) => execFileSync("git", ["-C", base, ...args], { encoding: "utf8" });
  run("init", "-q", "-b", "main");
  run("config", "user.name", "Sync Test");
  run("config", "user.email", "sync@example.test");
  return { base, run };
}
async function commit(base, run, file, text, message) {
  await writeFile(join(base, file), text);
  run("add", ".");
  run("commit", "-qm", message);
}
const cleanup = (...paths) =>
  Promise.all(paths.map((path) => rm(path, { recursive: true, force: true })));

test("fetch, pull and push exchange commits with the remote", async () => {
  const { base, run } = await repository();
  const remote = await mkdtemp(join(tmpdir(), "projector-sync-remote-"));
  const other = await mkdtemp(join(tmpdir(), "projector-sync-other-"));
  try {
    execFileSync("git", ["init", "-q", "--bare", "-b", "main", remote]);
    await commit(base, run, "a.txt", "a\n", "one");
    run("remote", "add", "origin", remote);
    run("push", "-q", "-u", "origin", "main");

    execFileSync("git", ["clone", "-q", remote, join(other, "work")]);
    const clone = (...args) =>
      execFileSync("git", ["-C", join(other, "work"), ...args], { encoding: "utf8" });
    clone("config", "user.name", "Other");
    clone("config", "user.email", "other@example.test");
    await writeFile(join(other, "work", "b.txt"), "b\n");
    clone("add", ".");
    clone("commit", "-qm", "remote work");
    clone("push", "-q", "origin", "main");

    const fetched = await mutateProjectSync(base, "fetch");
    expect(fetched.action).toBe("fetch");
    expect(fetched.branches.remotes).toStrictEqual(["origin"]);
    expect(fetched.branches.branches.find((branch) => branch.name === "main").behind).toBe(1);

    const pulled = await mutateProjectSync(base, "pull");
    expect(pulled.message).toBe("Изменения получены");
    expect(pulled.branches.branches.find((branch) => branch.name === "main").behind).toBe(0);
    expect(run("log", "--format=%s", "-1").trim()).toBe("remote work");

    await commit(base, run, "c.txt", "c\n", "local work");
    const pushed = await mutateProjectSync(base, "push");
    expect(pushed.message).toBe("Отправлено коммитов: 1");
    expect(pushed.branches.branches.find((branch) => branch.name === "main").ahead).toBe(0);
    expect(
      execFileSync("git", ["--git-dir", remote, "log", "--format=%s", "-1", "main"], {
        encoding: "utf8",
      }).trim(),
    ).toBe("local work");
  } finally {
    await cleanup(other, remote, base);
  }
});

test("a branch without upstream is published and starts tracking it", async () => {
  const { base, run } = await repository();
  const remote = await mkdtemp(join(tmpdir(), "projector-sync-remote-"));
  try {
    execFileSync("git", ["init", "-q", "--bare", "-b", "main", remote]);
    await commit(base, run, "a.txt", "a\n", "one");
    run("remote", "add", "origin", remote);
    run("switch", "-q", "-c", "feature");

    const published = await mutateProjectSync(base, "push");
    expect(published.message).toBe("Ветка feature опубликована");
    const branch = published.branches.branches.find((item) => item.name === "feature");
    expect(branch.upstream).toBe("origin/feature");
    expect(branch.ahead).toBe(0);
    expect(branch.behind).toBe(0);
    expect(
      execFileSync("git", ["--git-dir", remote, "rev-parse", "feature"], {
        encoding: "utf8",
      }).trim(),
    ).toBe(run("rev-parse", "HEAD").trim());

    // A second push has nothing to send; it stays a no-op instead of forcing anything.
    const again = await mutateProjectSync(base, "push");
    expect(again.message).toBe("Нечего отправлять");
    expect(again.branches.branches.find((item) => item.name === "feature").upstream).toBe(
      "origin/feature",
    );
  } finally {
    await cleanup(remote, base);
  }
});

test("pull refuses diverged branches and leaves the working tree intact", async () => {
  const { base, run } = await repository();
  const remote = await mkdtemp(join(tmpdir(), "projector-sync-remote-"));
  const other = await mkdtemp(join(tmpdir(), "projector-sync-other-"));
  try {
    execFileSync("git", ["init", "-q", "--bare", "-b", "main", remote]);
    await commit(base, run, "a.txt", "a\n", "one");
    run("remote", "add", "origin", remote);
    run("push", "-q", "-u", "origin", "main");

    execFileSync("git", ["clone", "-q", remote, join(other, "work")]);
    const clone = (...args) =>
      execFileSync("git", ["-C", join(other, "work"), ...args], { encoding: "utf8" });
    clone("config", "user.name", "Other");
    clone("config", "user.email", "other@example.test");
    await writeFile(join(other, "work", "remote.txt"), "remote\n");
    clone("add", ".");
    clone("commit", "-qm", "remote work");
    clone("push", "-q", "origin", "main");

    await commit(base, run, "local.txt", "local\n", "local work");
    await mutateProjectSync(base, "fetch");
    const before = await projectBranches(base);
    expect(before.branches.find((branch) => branch.name === "main")).toMatchObject({
      ahead: 1,
      behind: 1,
    });

    await expect(mutateProjectSync(base, "pull")).rejects.toMatchObject({ status: 409 });
    expect(run("log", "--format=%s", "-1").trim()).toBe("local work");
    expect(run("status", "--porcelain").trim()).toBe("");
  } finally {
    await cleanup(other, remote, base);
  }
});

test("sync without a remote or on a detached HEAD is rejected", async () => {
  const { base, run } = await repository();
  try {
    await commit(base, run, "a.txt", "a\n", "one");
    for (const action of ["fetch", "pull", "push"])
      await expect(mutateProjectSync(base, action)).rejects.toMatchObject({ status: 409 });
    await expect(mutateProjectSync(base, "merge")).rejects.toMatchObject({ status: 400 });

    run("switch", "-q", "--detach", "HEAD");
    await expect(mutateProjectSync(base, "fetch")).rejects.toMatchObject({ status: 409 });
  } finally {
    await cleanup(base);
  }
});
