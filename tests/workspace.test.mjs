import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, writeFile, rm, symlink, readFile, lstat, chmod } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import {
  listProjectDirectory,
  readProjectFile,
  searchProject,
  projectGit,
  projectComparison,
  moveProjectEntry,
} from "../server/modules/workspace/index.ts";
import { moveDestination, parentPath, relocatedPath } from "../core/modules/workspace/index.ts";
const root = await mkdtemp(join(tmpdir(), "projector-workspace-"));
const git = (...args) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8" });
test("file tree and Git changes report execute bits for files, including chmod-only changes", async () => {
  const base = await mkdtemp(join(tmpdir(), "projector-executable-"));
  const runGit = (...args) => execFileSync("git", ["-C", base, ...args]);
  try {
    await mkdir(join(base, "folder"), { mode: 0o755 });
    for (const [name, mode] of [
      ["plain.ts", 0o644],
      ["run", 0o755],
      ["group-only", 0o610],
      ["other-only", 0o601],
    ]) {
      await writeFile(join(base, name), "test\n");
      await chmod(join(base, name), mode);
    }
    const entries = (await listProjectDirectory(base)).entries;
    assert.equal(entries.find((entry) => entry.name === "folder").executable, false);
    assert.equal(entries.find((entry) => entry.name === "plain.ts").executable, false);
    for (const name of ["run", "group-only", "other-only"])
      assert.equal(entries.find((entry) => entry.name === name).executable, true, name);
    runGit("init", "-q");
    const untracked = (await projectGit(base)).changes;
    assert.equal(untracked.find((entry) => entry.path === "run").executable, true);
    runGit("config", "user.name", "Test");
    runGit("config", "user.email", "test@example.test");
    runGit("config", "core.filemode", "true");
    runGit("add", "plain.ts");
    runGit("commit", "-qm", "initial");
    await chmod(join(base, "plain.ts"), 0o755);
    assert.equal(
      (await projectGit(base)).changes.find((entry) => entry.path === "plain.ts").executable,
      true,
    );
    await chmod(join(base, "run"), 0o644);
    assert.equal(
      (await listProjectDirectory(base)).entries.find((entry) => entry.name === "run").executable,
      false,
    );
    await rm(join(base, "plain.ts"));
    assert.equal(
      (await projectGit(base)).changes.find((entry) => entry.path === "plain.ts").executable,
      false,
    );
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});
test("tree move destinations and open-file paths respect directory boundaries", () => {
  assert.equal(parentPath("src/nested/file.ts"), "src/nested");
  assert.equal(parentPath("file.ts"), "");
  assert.equal(moveDestination("src/file.ts", ""), "file.ts");
  assert.equal(moveDestination("src/file.ts", "docs"), "docs/file.ts");
  for (const [source, target] of [
    ["", "src"],
    ["src", "src"],
    ["src", "src/nested"],
    ["src/file.ts", "src"],
  ])
    assert.equal(moveDestination(source, target), undefined);
  assert.equal(moveDestination("src", "src-other"), "src-other/src");
  assert.equal(relocatedPath("src/nested/file.ts", "src", "docs/src"), "docs/src/nested/file.ts");
  assert.equal(relocatedPath("src-other/file.ts", "src", "docs/src"), "src-other/file.ts");
});

test("moves preserve contents, never overwrite, and reject self, traversal, excluded and symlink paths", async () => {
  const base = await mkdtemp(join(tmpdir(), "projector-move-"));
  try {
    for (const folder of ["src/nested", "docs", "other", ".git", "node_modules"])
      await mkdir(join(base, folder), { recursive: true });
    await writeFile(join(base, "src/nested/файл с пробелом.ts"), "preserved");
    await writeFile(join(base, "docs/collision"), "destination");
    await writeFile(join(base, "src/collision"), "source");
    await symlink(join(base, "docs"), join(base, "alias"));
    await symlink("/etc", join(base, "external"));
    await symlink(join(base, "missing"), join(base, "docs/dangling"));
    await writeFile(join(base, "src/dangling"), "keep");
    assert.deepEqual(await moveProjectEntry(base, "src/nested/файл с пробелом.ts", "docs"), {
      source: "src/nested/файл с пробелом.ts",
      destination: "docs/файл с пробелом.ts",
    });
    assert.equal(await readFile(join(base, "docs/файл с пробелом.ts"), "utf8"), "preserved");
    await moveProjectEntry(base, "docs/файл с пробелом.ts", "");
    assert.equal(await readFile(join(base, "файл с пробелом.ts"), "utf8"), "preserved");
    await assert.rejects(moveProjectEntry(base, "src/collision", "docs"), { status: 409 });
    assert.equal(await readFile(join(base, "src/collision"), "utf8"), "source");
    assert.equal(await readFile(join(base, "docs/collision"), "utf8"), "destination");
    await assert.rejects(moveProjectEntry(base, "src/dangling", "docs"), { status: 409 });
    for (const [source, target, status] of [
      ["", "docs", 400],
      ["src", "src/nested", 400],
      ["src", "src", 400],
      ["src/collision", "src", 400],
      ["../outside", "docs", 403],
      ["/etc/passwd", "docs", 403],
      ["src/collision", "../outside", 403],
      ["src/collision", "alias", 403],
      ["alias/collision", "other", 403],
      ["src/collision", "external", 403],
      ["src/collision", ".git", 403],
      ["node_modules", "docs", 403],
      ["src/./collision", "docs", 403],
      ["src/collision", "src/dangling", 400],
    ])
      await assert.rejects(moveProjectEntry(base, source, target), { status });
    await moveProjectEntry(base, "src", "other");
    assert.ok((await lstat(join(base, "other/src/nested"))).isDirectory());
    assert.equal(await readFile(join(base, "other/src/collision"), "utf8"), "source");
    await writeFile(join(base, "docs/race"), "one");
    await writeFile(join(base, "other/race"), "two");
    const results = await Promise.allSettled([
      moveProjectEntry(base, "docs/race", ""),
      moveProjectEntry(base, "other/race", ""),
    ]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(results.find((result) => result.status === "rejected").reason.status, 409);
    const winner = await readFile(join(base, "race"), "utf8");
    assert.equal(
      await readFile(join(base, winner === "one" ? "other/race" : "docs/race"), "utf8"),
      winner === "one" ? "two" : "one",
    );
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});
test("workspace tree, bounded reading, traversal and symlink containment, literal search", async () => {
  try {
    await mkdir(join(root, "src"));
    await mkdir(join(root, "node_modules"));
    await writeFile(join(root, ".gitignore"), "ignored.txt\n");
    await writeFile(join(root, "src/code.ts"), 'const word = "Привет [world]";\n');
    await writeFile(join(root, "ignored.txt"), "[world]");
    await writeFile(join(root, "node_modules/dependency.js"), "[world]");
    await writeFile(join(root, "binary"), Buffer.from([0, 1]));
    await writeFile(join(root, "large"), Buffer.alloc(1024 * 1024 + 1, 65));
    await symlink("/etc", join(root, "external"));
    const tree = await listProjectDirectory(root);
    assert.equal(tree.entries[0].directory, true);
    assert.ok(tree.entries.some((entry) => entry.name === ".gitignore"));
    assert.ok(!tree.entries.some((entry) => ["node_modules", "external"].includes(entry.name)));
    assert.match((await readProjectFile(root, "src/code.ts")).content, /Привет/);
    await assert.rejects(readProjectFile(root, "../outside"), { status: 403 });
    await assert.rejects(readProjectFile(root, "/etc/passwd"), { status: 403 });
    await assert.rejects(readProjectFile(root, "external/passwd"), { status: 403 });
    await assert.rejects(readProjectFile(root, "binary"), { status: 415 });
    await assert.rejects(readProjectFile(root, "large"), { status: 413 });
    assert.equal((await projectGit(root)).available, false);
    git("init", "-q");
    git("config", "user.name", "Workspace Test");
    git("config", "user.email", "test@example.test");
    const search = await searchProject(root, "[WORLD]");
    assert.deepEqual(
      search.hits.map((hit) => [hit.path, hit.line, hit.column]),
      [["src/code.ts", 1, 22]],
    );
    git("add", "src/code.ts", ".gitignore");
    git("commit", "-qm", "initial");
    await writeFile(join(root, "src/code.ts"), "staged\n");
    git("add", "src/code.ts");
    await writeFile(join(root, "src/code.ts"), "working\n");
    const staged = await projectComparison(root, "src/code.ts", true);
    assert.match(staged.original, /Привет/);
    assert.equal(staged.modified, "staged\n");
    const working = await projectComparison(root, "src/code.ts", false);
    assert.equal(working.original, "staged\n");
    assert.equal(working.modified, "working\n");
    const nested = await projectGit(join(root, "src"));
    assert.equal(nested.changes[0].path, "code.ts");
    assert.equal(
      (await projectComparison(join(root, "src"), "code.ts", false)).original,
      "staged\n",
    );
    await writeFile(join(root, "new file.ts"), "new\n");
    assert.equal((await projectComparison(root, "new file.ts", false)).original, "");
    git("reset", "--hard", "-q");
    git("mv", "src/code.ts", "src/renamed.ts");
    const rename = await projectComparison(root, "src/renamed.ts", true);
    assert.match(rename.original, /Привет/);
    assert.equal(rename.modified, rename.original);
    git("reset", "--hard", "-q");
    await rm(join(root, "src/code.ts"));
    assert.equal((await projectComparison(root, "src/code.ts", false)).modified, "");
    await assert.rejects(projectComparison(root, "../outside", false), { status: 403 });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("workspace HTTP routes resolve catalog projects and reject foreign origins and hosts", async () => {
  const { createServer, request: httpRequest } = await import("node:http");
  const { once } = await import("node:events");
  const directory = await mkdtemp(join(tmpdir(), "projector-workspace-api-"));
  process.env.XDG_DATA_HOME = directory;
  await mkdir(join(directory, "projector"));
  await writeFile(join(directory, "sample.ts"), "const sample = true;\n");
  await writeFile(
    join(directory, "projector/projects.json"),
    JSON.stringify({
      projects: [
        { id: "workspace-test", path: directory, name: "test", commands: [], createdAt: "" },
      ],
    }),
  );
  const { handleApi } = await import("../server/app/api.ts");
  const server = createServer((req, res) => {
    void handleApi(req, res).then((handled) => {
      if (!handled) res.writeHead(404).end();
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;
  const route = `${base}/api/projects/workspace-test/workspace`;
  try {
    const file = await fetch(`${route}/file?path=sample.ts`);
    assert.equal(file.status, 200);
    assert.equal(file.headers.get("cache-control"), "no-store");
    assert.equal((await file.json()).content, "const sample = true;\n");
    assert.ok(
      (await (await fetch(`${route}/tree`)).json()).entries.some(
        (entry) => entry.path === "sample.ts",
      ),
    );
    assert.equal(
      (await (await fetch(`${route}/search?q=sample`)).json()).hits[0].path,
      "sample.ts",
    );
    assert.equal((await (await fetch(`${route}/git`)).json()).available, false);
    assert.equal((await fetch(`${route}/file?path=../outside`)).status, 403);
    assert.equal(
      (await fetch(`${route}/file?path=sample.ts`, { headers: { Origin: "https://foreign.test" } }))
        .status,
      403,
    );
    const foreignStatus = await new Promise((resolve, reject) => {
      const request = httpRequest(
        `${route}/file?path=sample.ts`,
        { headers: { Host: "foreign.test" } },
        (response) => {
          response.resume();
          resolve(response.statusCode);
        },
      );
      request.on("error", reject);
      request.end();
    });
    assert.equal(foreignStatus, 403);
    const folders = `${base}/api/directories?${new URLSearchParams({ path: directory })}`;
    const folderResponse = await fetch(folders);
    assert.equal(folderResponse.status, 200);
    assert.equal(folderResponse.headers.get("cache-control"), "no-store");
    assert.deepEqual((await folderResponse.json()).entries, [
      { name: "projector", path: join(directory, "projector") },
    ]);
    assert.equal(
      (await fetch(folders, { headers: { Origin: "https://foreign.test" } })).status,
      403,
    );
    const foreignFolder = await new Promise((resolve, reject) => {
      const request = httpRequest(folders, { headers: { Host: "foreign.test" } }, (response) => {
        response.resume();
        resolve(response.statusCode);
      });
      request.on("error", reject);
      request.end();
    });
    assert.equal(foreignFolder, 403);
    assert.equal((await fetch(`${base}/api/projects/missing/workspace/tree`)).status, 404);
    const move = (body, origin = base) =>
      fetch(`${route}/move`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: origin },
        body: JSON.stringify(body),
      });
    assert.equal(
      (await move({ path: "sample.ts", directory: "projector" }, "https://foreign.test")).status,
      403,
    );
    assert.equal((await move({ directory: "projector" })).status, 400);
    assert.equal((await move({ path: "../sample.ts", directory: "projector" })).status, 403);
    const moved = await move({ path: "sample.ts", directory: "projector" });
    assert.equal(moved.status, 200);
    assert.equal(moved.headers.get("cache-control"), "no-store");
    assert.deepEqual(await moved.json(), {
      source: "sample.ts",
      destination: "projector/sample.ts",
    });
    assert.equal((await fetch(`${route}/file?path=projector/sample.ts`)).status, 200);
    assert.equal((await fetch(`${route}/file?path=sample.ts`)).status, 400);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});

test("path bar lists real directories and symlinks, completes prefixes and rejects invalid paths", async () => {
  const { listDirectories } = await import("../server/modules/directories/index.ts");
  const base = await mkdtemp(join(tmpdir(), "projector-directories-"));
  try {
    await mkdir(join(base, "alpha"));
    await mkdir(join(base, "alphabet"));
    await mkdir(join(base, "with space"));
    await mkdir(join(base, ".hidden"));
    await writeFile(join(base, "a-file"), "text");
    await symlink(join(base, "alpha"), join(base, "alias"));
    await symlink(join(base, "missing"), join(base, "broken"));
    const listing = await listDirectories(base);
    assert.equal(listing.path, base);
    assert.deepEqual(
      listing.entries.map((row) => row.name),
      [".hidden", "alias", "alpha", "alphabet", "with space"],
    );
    const completions = await listDirectories(`${base}/alph`, true);
    assert.deepEqual(
      completions.entries.map((row) => row.path),
      [join(base, "alpha"), join(base, "alphabet")],
    );
    assert.equal((await listDirectories(`${base}/`, true)).entries.length, 5);
    assert.equal((await listDirectories(join(base, "with space"))).entries.length, 0);
    await assert.rejects(listDirectories("relative/path"), { status: 400 });
    await assert.rejects(listDirectories(`${base}\0`), { status: 400 });
    await assert.rejects(listDirectories(join(base, "a-file")), { status: 400 });
    await assert.rejects(listDirectories(join(base, "missing")), { status: 400 });
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});
