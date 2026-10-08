import { afterAll, expect, test } from "vite-plus/test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import {
  mkdtemp,
  mkdir,
  writeFile,
  rm,
  readdir,
  symlink,
  readFile,
  lstat,
  chmod,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import {
  listProjectDirectory,
  readProjectFile,
  searchProject,
  projectGit,
  projectGithubRepository,
  projectComparison,
  projectGutter,
  mutateProjectGit,
  moveProjectEntry,
  mutateProjectEntry,
  saveProjectFile,
  readProjectImage,
  previewProjectFile,
  withFilesExclude,
} from "../server/modules/workspace/index.ts";
import { projectRelativePath, previewBrowserFile } from "../src/modules/workspace/file-drop.ts";
import {
  defaultFilesExclude,
  moveDestination,
  parentPath,
  relocatedPath,
} from "../core/modules/workspace/index.ts";
import { githubRepositoryFromRemote } from "../core/modules/github/index.ts";
import {
  fitImage,
  zoomImageAt,
} from "../src/modules/workspace/modules/viewers/lib/image-viewport.ts";

/** Workspace excludes are global settings; isolate them from the developer machine. */
function withDefaultExcludes(run) {
  return withFilesExclude(defaultFilesExclude(), run);
}

const posix = process.platform !== "win32";
// A real directory outside every project, standing in for /etc and /tmp on every platform.
const outside = mkdtempSync(join(tmpdir(), "projector-outside-"));
writeFileSync(join(outside, "passwd"), "outside");
afterAll(() => rmSync(outside, { recursive: true, force: true }));
test("image zoom keeps the cursor anchor fixed, including at zoom limits", () => {
  const initial = { zoom: 2, x: 40, y: -30 };
  const anchor = { x: 130, y: 75 };
  for (const requested of [0.0001, 0.5, 4, 100]) {
    const next = zoomImageAt(initial, requested, anchor.x, anchor.y);
    expect(next.zoom >= 1 / 64 && next.zoom <= 32).toBeTruthy();
    expect((anchor.x - next.x) / next.zoom).toBe((anchor.x - initial.x) / initial.zoom);
    expect((anchor.y - next.y) / next.zoom).toBe((anchor.y - initial.y) / initial.zoom);
  }
  expect(fitImage(2000, 1000, 1048, 548)).toBe(0.5);
  expect(fitImage(200, 100, 1048, 548)).toBe(5);
  expect(fitImage(20, 10, 1048, 548)).toBe(32);
});
test("incremental image zoom stops at 100% in both directions and can continue afterward", () => {
  for (const [start, requested] of [
    [0.99, 1.01],
    [1.01, 0.99],
    [0.5, 2],
    [2, 0.5],
  ]) {
    const original = { zoom: start, x: 20, y: -40 };
    const stopped = zoomImageAt(original, requested, 120, 60);
    expect(stopped.zoom).toBe(1);
    expect((120 - stopped.x) / stopped.zoom).toBe((120 - original.x) / original.zoom);
    expect((60 - stopped.y) / stopped.zoom).toBe((60 - original.y) / original.zoom);
    expect(zoomImageAt(stopped, requested, 120, 60).zoom).toBe(requested);
  }
  expect(zoomImageAt({ zoom: 0.5, x: 0, y: 0 }, 0.75, 0, 0).zoom).toBe(0.75);
});
test("file drops preserve external contents and distinguish project paths", async () => {
  expect(projectRelativePath("/tmp/project", "/tmp/project/README.md")).toBe("README.md");
  expect(projectRelativePath("/tmp/project/", "/tmp/project/src/file.ts")).toBe("src/file.ts");
  expect(projectRelativePath("/tmp/project", "/tmp/project-other/file.ts")).toBe(undefined);
  const file = new File(["# External\n"], "external.md");
  expect(await previewBrowserFile(file)).toStrictEqual({
    path: "external.md",
    content: "# External\n",
  });
  await expect(previewBrowserFile(new File(["a\0b"], "binary.bin"))).rejects.toThrow(
    /Бинарный файл/,
  );
  await expect(
    previewBrowserFile(new File([new Uint8Array(1024 * 1024 + 1)], "large.txt")),
  ).rejects.toThrow(/больше 1 МБ/);
  const svg = "<svg xmlns='http://www.w3.org/2000/svg'/>";
  expect(await previewBrowserFile(new File([svg], "external.SVG"))).toStrictEqual({
    path: "external.SVG",
    content: svg,
  });
  const image = await previewBrowserFile(
    new File([new Uint8Array([137, 80, 78, 71])], "external.png"),
  );
  expect(image.image.startsWith("blob:")).toBeTruthy();
  URL.revokeObjectURL(image.image);
});

const root = await mkdtemp(join(tmpdir(), "projector-workspace-"));
const git = (...args) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8" });
test("entry actions create, copy, rename and trash without overwriting or escaping the project", async () => {
  const base = await mkdtemp(join(tmpdir(), "projector-entries-"));
  try {
    await mutateProjectEntry(base, "create-directory", "", "", "folder");
    await mutateProjectEntry(base, "create-file", "", "folder", "note.md");
    await writeFile(join(base, "folder/note.md"), "draft");
    expect(await mutateProjectEntry(base, "rename", "folder/note.md", "", "new.md")).toStrictEqual({
      source: "folder/note.md",
      destination: "folder/new.md",
    });
    await mutateProjectEntry(base, "copy", "folder", "", "copy");
    expect(await readFile(join(base, "copy/new.md"), "utf8")).toBe("draft");
    for (const action of ["create-file", "create-directory", "copy"])
      await expect(mutateProjectEntry(base, action, "folder", "", "copy")).rejects.toMatchObject({
        status: 409,
      });
    await expect(
      mutateProjectEntry(base, "copy", "folder", "folder", "child"),
    ).rejects.toMatchObject({
      status: 400,
    });
    await mutateProjectEntry(base, "create-file", "", "folder", "other.md");
    await expect(
      mutateProjectEntry(base, "rename", "folder/new.md", "", "other.md"),
    ).rejects.toMatchObject({
      status: 409,
    });
    await symlink(base, join(base, "alias"));
    for (const action of ["rename", "delete", "copy"])
      for (const path of ["", "../outside", "alias", "alias/folder", ".git/config"])
        await expect(mutateProjectEntry(base, action, path, "", "valid")).rejects.toMatchObject({
          status: 403,
        });
    for (const name of [
      "../outside",
      "a/b",
      "a\\b",
      ".",
      "..",
      ".git",
      ".projector-trash",
      "\0",
      "   ",
    ])
      await expect(mutateProjectEntry(base, "create-file", "", "", name)).rejects.toMatchObject({
        status: 400,
      });
    await expect(
      mutateProjectEntry(base, "create-file", "", "alias", "valid"),
    ).rejects.toMatchObject({
      status: 403,
    });
    execFileSync("git", ["-C", base, "init", "-q"]);
    await mutateProjectEntry(base, "delete", "folder");
    const trashed = await readdir(join(base, ".projector-trash"));
    expect(trashed.length).toBe(1);
    expect(
      (await projectGit(base)).changes.every((change) => !change.path.includes(".projector-trash")),
    ).toBeTruthy();
    expect(await readFile(join(base, ".projector-trash", trashed[0], "new.md"), "utf8")).toBe(
      "draft",
    );
    expect((await listProjectDirectory(base)).entries.map((entry) => entry.name)).toStrictEqual([
      "copy",
    ]);
    await rm(join(base, ".projector-trash"), { recursive: true });
    await symlink(tmpdir(), join(base, ".projector-trash"));
    await expect(mutateProjectEntry(base, "delete", "copy")).rejects.toMatchObject({ status: 403 });
    expect(await readFile(join(base, "copy/new.md"), "utf8")).toBe("draft");
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});
test("Text file saves preserve text and mode, reject stale drafts and contain writes", async () => {
  const base = await mkdtemp(join(tmpdir(), "projector-markdown-"));
  try {
    await writeFile(join(base, "readme.md"), "# Original\r\n", { mode: 0o640 });
    await saveProjectFile(base, "readme.md", "# Новый текст\r\n", "# Original\r\n");
    expect(await readFile(join(base, "readme.md"), "utf8")).toBe("# Новый текст\r\n");
    if (process.platform !== "win32")
      expect((await lstat(join(base, "readme.md"))).mode & 0o777).toBe(0o640);
    await expect(
      saveProjectFile(base, "readme.md", "stale", "# Original\r\n"),
    ).rejects.toMatchObject({
      status: 409,
    });
    const competing = await Promise.allSettled([
      saveProjectFile(base, "readme.md", "first", "# Новый текст\r\n"),
      saveProjectFile(base, "readme.md", "second", "# Новый текст\r\n"),
    ]);
    expect(competing.filter((result) => result.status === "fulfilled").length).toBe(1);
    expect(competing.find((result) => result.status === "rejected").reason.status).toBe(409);
    await symlink(join(base, "readme.md"), join(base, "alias.md"));
    await mkdir(join(base, ".git"));
    await writeFile(join(base, ".git/config.md"), "protected");
    for (const path of ["../outside.md", "/tmp/outside.md", "alias.md", ".git/config.md"])
      await expect(saveProjectFile(base, path, "test", "")).rejects.toMatchObject({
        status: 403,
      });
    for (const path of ["plain.ts", "settings.json", ".gitignore", "LICENSE"]) {
      await writeFile(join(base, path), "original\r\n", { mode: 0o750 });
      await saveProjectFile(base, path, "Изменено\r\n", "original\r\n");
      expect(await readFile(join(base, path), "utf8")).toBe("Изменено\r\n");
      if (process.platform !== "win32")
        expect((await lstat(join(base, path))).mode & 0o777).toBe(0o750);
      await expect(saveProjectFile(base, path, "stale", "original\r\n")).rejects.toMatchObject({
        status: 409,
      });
    }
    await writeFile(join(base, "binary.bin"), Buffer.from([0, 1]));
    await expect(saveProjectFile(base, "binary.bin", "text", "")).rejects.toMatchObject({
      status: 415,
    });
    await expect(saveProjectFile(base, "readme.md", "\0", "first")).rejects.toMatchObject({
      status: 415,
    });
    await expect(
      saveProjectFile(base, "readme.md", "x".repeat(1024 * 1024 + 1), ""),
    ).rejects.toMatchObject({
      status: 413,
    });
    await writeFile(join(base, "picture.png"), Buffer.from([137, 80, 78, 71]));
    const image = await readProjectImage(base, "picture.png");
    expect(image.type).toBe("image/png");
    expect(image.content).toStrictEqual(Buffer.from([137, 80, 78, 71]));
    expect(await previewProjectFile(base, "picture.png")).toStrictEqual({
      path: "picture.png",
      content: "",
      image: true,
    });
    await expect(readProjectImage(base, "readme.md")).rejects.toMatchObject({ status: 415 });
    await expect(readProjectImage(base, "../picture.png")).rejects.toMatchObject({ status: 403 });
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});
test.skipIf(!posix)(
  "file tree and Git changes report execute bits for files, including chmod-only changes",
  async () => {
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
      expect(entries.find((entry) => entry.name === "folder").executable).toBe(false);
      expect(entries.find((entry) => entry.name === "plain.ts").executable).toBe(false);
      for (const name of ["run", "group-only", "other-only"])
        expect(entries.find((entry) => entry.name === name).executable, name).toBe(true);
      runGit("init", "-q");
      const untracked = (await projectGit(base)).changes;
      expect(untracked.find((entry) => entry.path === "run").executable).toBe(true);
      runGit("config", "user.name", "Test");
      runGit("config", "user.email", "test@example.test");
      runGit("config", "core.filemode", "true");
      runGit("add", "plain.ts");
      runGit("commit", "-qm", "initial");
      await chmod(join(base, "plain.ts"), 0o755);
      expect(
        (await projectGit(base)).changes.find((entry) => entry.path === "plain.ts").executable,
      ).toBe(true);
      await chmod(join(base, "run"), 0o644);
      expect(
        (await listProjectDirectory(base)).entries.find((entry) => entry.name === "run").executable,
      ).toBe(false);
      await rm(join(base, "plain.ts"));
      expect(
        (await projectGit(base)).changes.find((entry) => entry.path === "plain.ts").executable,
      ).toBe(false);
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  },
);
test("tree move destinations and open-file paths respect directory boundaries", () => {
  expect(parentPath("src/nested/file.ts")).toBe("src/nested");
  expect(parentPath("file.ts")).toBe("");
  expect(moveDestination("src/file.ts", "")).toBe("file.ts");
  expect(moveDestination("src/file.ts", "docs")).toBe("docs/file.ts");
  for (const [source, target] of [
    ["", "src"],
    ["src", "src"],
    ["src", "src/nested"],
    ["src/file.ts", "src"],
  ])
    expect(moveDestination(source, target)).toBe(undefined);
  expect(moveDestination("src", "src-other")).toBe("src-other/src");
  expect(relocatedPath("src/nested/file.ts", "src", "docs/src")).toBe("docs/src/nested/file.ts");
  expect(relocatedPath("src-other/file.ts", "src", "docs/src")).toBe("src-other/file.ts");
});

test("moves preserve contents, never overwrite, and reject self, traversal, excluded and symlink paths", async () => {
  await withDefaultExcludes(async () => {
    const base = await mkdtemp(join(tmpdir(), "projector-move-"));
    try {
      for (const folder of ["src/nested", "docs", "other", ".git", "node_modules"])
        await mkdir(join(base, folder), { recursive: true });
      await writeFile(join(base, "src/nested/файл с пробелом.ts"), "preserved");
      await writeFile(join(base, "docs/collision"), "destination");
      await writeFile(join(base, "src/collision"), "source");
      await symlink(join(base, "docs"), join(base, "alias"));
      await symlink(outside, join(base, "external"));
      await symlink(join(base, "missing"), join(base, "docs/dangling"));
      await writeFile(join(base, "src/dangling"), "keep");
      expect(await moveProjectEntry(base, "src/nested/файл с пробелом.ts", "docs")).toStrictEqual({
        source: "src/nested/файл с пробелом.ts",
        destination: "docs/файл с пробелом.ts",
      });
      expect(await readFile(join(base, "docs/файл с пробелом.ts"), "utf8")).toBe("preserved");
      await moveProjectEntry(base, "docs/файл с пробелом.ts", "");
      expect(await readFile(join(base, "файл с пробелом.ts"), "utf8")).toBe("preserved");
      await expect(moveProjectEntry(base, "src/collision", "docs")).rejects.toMatchObject({
        status: 409,
      });
      expect(await readFile(join(base, "src/collision"), "utf8")).toBe("source");
      expect(await readFile(join(base, "docs/collision"), "utf8")).toBe("destination");
      await expect(moveProjectEntry(base, "src/dangling", "docs")).rejects.toMatchObject({
        status: 409,
      });
      for (const [source, target, status] of [
        ["", "docs", 400],
        ["src", "src/nested", 400],
        ["src", "src", 400],
        ["src/collision", "src", 400],
        ["../outside", "docs", 403],
        [join(outside, "passwd"), "docs", 403],
        ["src/collision", "../outside", 403],
        ["src/collision", "alias", 403],
        ["alias/collision", "other", 403],
        ["src/collision", "external", 403],
        ["src/collision", ".git", 403],
        ["node_modules", "docs", 403],
        ["src/./collision", "docs", 403],
        ["src/collision", "src/dangling", 400],
      ])
        await expect(moveProjectEntry(base, source, target)).rejects.toMatchObject({ status });
      await moveProjectEntry(base, "src", "other");
      expect((await lstat(join(base, "other/src/nested"))).isDirectory()).toBeTruthy();
      expect(await readFile(join(base, "other/src/collision"), "utf8")).toBe("source");
      await writeFile(join(base, "docs/race"), "one");
      await writeFile(join(base, "other/race"), "two");
      const results = await Promise.allSettled([
        moveProjectEntry(base, "docs/race", ""),
        moveProjectEntry(base, "other/race", ""),
      ]);
      expect(results.filter((result) => result.status === "fulfilled").length).toBe(1);
      expect(results.find((result) => result.status === "rejected").reason.status).toBe(409);
      const winner = await readFile(join(base, "race"), "utf8");
      expect(
        await readFile(join(base, winner === "one" ? "other/race" : "docs/race"), "utf8"),
      ).toBe(winner === "one" ? "two" : "one");
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });
});

test("files exclude setting controls tree visibility for node_modules", async () => {
  const root = await mkdtemp(join(tmpdir(), "projector-exclude-project-"));
  try {
    await mkdir(join(root, "node_modules"));
    await writeFile(join(root, "readme.md"), "hi");
    await withFilesExclude(defaultFilesExclude(), async () => {
      expect(
        !(await listProjectDirectory(root)).entries.some((entry) => entry.name === "node_modules"),
      ).toBeTruthy();
      const next = { ...defaultFilesExclude() };
      delete next["**/node_modules"];
      await withFilesExclude(next, async () => {
        expect(
          (await listProjectDirectory(root)).entries.some((entry) => entry.name === "node_modules"),
        ).toBeTruthy();
      });
      expect(
        !(await listProjectDirectory(root)).entries.some((entry) => entry.name === "node_modules"),
      ).toBeTruthy();
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("workspace tree, bounded reading, traversal and symlink containment, literal search", async () => {
  await withDefaultExcludes(async () => {
    try {
      await mkdir(join(root, "src"));
      await mkdir(join(root, "node_modules"));
      await writeFile(join(root, ".gitignore"), "ignored.txt\n");
      await writeFile(join(root, "src/code.ts"), 'const word = "Привет [world]";\n');
      await writeFile(join(root, "ignored.txt"), "[world]");
      await writeFile(join(root, "node_modules/dependency.js"), "[world]");
      await writeFile(join(root, "binary"), Buffer.from([0, 1]));
      await writeFile(join(root, "large"), Buffer.alloc(1024 * 1024 + 1, 65));
      await symlink(outside, join(root, "external"));
      const tree = await listProjectDirectory(root);
      expect(tree.entries[0].directory).toBe(true);
      expect(tree.entries.some((entry) => entry.name === ".gitignore")).toBeTruthy();
      expect(
        !tree.entries.some((entry) => ["node_modules", "external"].includes(entry.name)),
      ).toBeTruthy();
      expect((await readProjectFile(root, "src/code.ts")).content).toMatch(/Привет/);
      await expect(readProjectFile(root, "../outside")).rejects.toMatchObject({ status: 403 });
      await expect(readProjectFile(root, join(outside, "passwd"))).rejects.toMatchObject({
        status: 403,
      });
      await expect(readProjectFile(root, "external/passwd")).rejects.toMatchObject({
        status: 403,
      });
      await expect(readProjectFile(root, "binary")).rejects.toMatchObject({ status: 415 });
      await expect(readProjectFile(root, "large")).rejects.toMatchObject({ status: 413 });
      expect((await projectGit(root)).available).toBe(false);
      git("init", "-q");
      git("config", "user.name", "Workspace Test");
      git("config", "user.email", "test@example.test");
      const search = await searchProject(root, "[WORLD]");
      expect(search.hits.map((hit) => [hit.path, hit.line, hit.column])).toStrictEqual([
        ["src/code.ts", 1, 22],
      ]);
      git("add", "src/code.ts", ".gitignore");
      git("commit", "-qm", "initial");
      await writeFile(join(root, "src/code.ts"), "staged\n");
      git("add", "src/code.ts");
      await writeFile(join(root, "src/code.ts"), "working\n");
      const staged = await projectComparison(root, "src/code.ts", true);
      expect(staged.original).toMatch(/Привет/);
      expect(staged.modified).toBe("staged\n");
      const working = await projectComparison(root, "src/code.ts", false);
      expect(working.original).toBe("staged\n");
      expect(working.modified).toBe("working\n");
      const nested = await projectGit(join(root, "src"));
      expect(nested.changes[0].path).toBe("code.ts");
      expect((await projectComparison(join(root, "src"), "code.ts", false)).original).toBe(
        "staged\n",
      );
      await writeFile(join(root, "new file.ts"), "new\n");
      expect((await projectComparison(root, "new file.ts", false)).original).toBe("");
      git("reset", "--hard", "-q");
      git("mv", "src/code.ts", "src/renamed.ts");
      const rename = await projectComparison(root, "src/renamed.ts", true);
      expect(rename.original).toMatch(/Привет/);
      expect(rename.modified).toBe(rename.original);
      git("reset", "--hard", "-q");
      await rm(join(root, "src/code.ts"));
      expect((await projectComparison(root, "src/code.ts", false)).modified).toBe("");
      await expect(projectComparison(root, "../outside", false)).rejects.toMatchObject({
        status: 403,
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

test("Git gutter returns the index text of tracked files only", async () => {
  const base = await mkdtemp(join(tmpdir(), "projector-gutter-"));
  try {
    const run = (...args) => execFileSync("git", ["-C", base, ...args], { encoding: "utf8" });
    run("init", "-q");
    run("config", "user.name", "Gutter Test");
    run("config", "user.email", "gutter@example.test");
    await mkdir(join(base, "sub"));
    await writeFile(join(base, "committed.txt"), "one\ntwo\n");
    await writeFile(join(base, "sub", "nested.txt"), "nested\n");
    run("add", ".");
    run("commit", "-qm", "initial");

    await writeFile(join(base, "committed.txt"), "staged\n");
    run("add", "committed.txt");
    await writeFile(join(base, "committed.txt"), "working\n");
    await writeFile(join(base, "untracked.txt"), "x\n");

    expect(await projectGutter(base, "committed.txt")).toStrictEqual({
      available: true,
      original: "staged\n",
    });
    expect(await projectGutter(join(base, "sub"), "nested.txt")).toStrictEqual({
      available: true,
      original: "nested\n",
    });
    expect(await projectGutter(base, "untracked.txt")).toStrictEqual({
      available: false,
      original: "",
    });
    await expect(projectGutter(base, "../outside")).rejects.toMatchObject({ status: 403 });

    const plain = await mkdtemp(join(tmpdir(), "projector-gutter-plain-"));
    try {
      await writeFile(join(plain, "file.txt"), "content\n");
      expect(await projectGutter(plain, "file.txt")).toStrictEqual({
        available: false,
        original: "",
      });
    } finally {
      await rm(plain, { recursive: true, force: true });
    }
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("workspace HTTP routes resolve catalog projects and reject foreign origins and hosts", async () => {
  const { createServer, request: httpRequest } = await import("node:http");
  const { once } = await import("node:events");
  const directory = await mkdtemp(join(tmpdir(), "projector-workspace-api-"));
  const externalDirectory = await mkdtemp(join(tmpdir(), "projector-external-preview-"));
  const externalPath = join(externalDirectory, "outside.txt");
  await writeFile(externalPath, "External file contents\n");
  await writeFile(
    join(externalDirectory, "outside.svg"),
    "<svg xmlns='http://www.w3.org/2000/svg'/>",
  );
  process.env.XDG_DATA_HOME = directory;
  await mkdir(join(directory, "projector"));
  await writeFile(join(directory, "sample.ts"), "const sample = true;\n");
  await writeFile(join(directory, "sample.md"), "# Original\n");
  const { gzipSync } = await import("node:zlib");
  await writeFile(join(directory, "sample.ts.gz"), gzipSync("const sample = true;\n"));
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
    const external = await fetch(`${route}/external?path=${encodeURIComponent(externalPath)}`);
    expect(external.status).toBe(200);
    expect(await external.json()).toStrictEqual({
      path: externalPath,
      content: "External file contents\n",
    });
    expect((await fetch(`${route}/external?path=relative.txt`)).status).toBe(400);
    expect(
      (
        await fetch(`${route}/external?path=${encodeURIComponent(externalPath)}`, {
          headers: { Origin: "https://foreign.test" },
        })
      ).status,
    ).toBe(403);
    const imagePath = join(externalDirectory, "outside.svg");
    const imagePreview = await (
      await fetch(`${route}/external?path=${encodeURIComponent(imagePath)}`)
    ).json();
    expect(imagePreview).toStrictEqual({
      path: imagePath,
      content: "<svg xmlns='http://www.w3.org/2000/svg'/>",
    });
    const image = await fetch(`${route}/external-asset?path=${encodeURIComponent(imagePath)}`);
    expect(image.headers.get("content-type")).toBe("image/svg+xml");
    expect(image.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await image.text()).toMatch(/<svg/);
    const file = await fetch(`${route}/file?path=sample.ts`);
    expect(file.status).toBe(200);
    expect(file.headers.get("cache-control")).toBe("no-store");
    expect((await file.json()).content).toBe("const sample = true;\n");
    const archive = await fetch(`${route}/file?path=sample.ts.gz`);
    expect(archive.status).toBe(200);
    expect(archive.headers.get("cache-control")).toBe("no-store");
    const preview = await archive.json();
    expect(preview.archive.format).toBe("GZIP");
    expect(preview.archive.entries).toStrictEqual([{ path: "sample.ts", type: "file", size: 21 }]);
    expect(
      (await (await fetch(`${route}/tree`)).json()).entries.some(
        (entry) => entry.path === "sample.ts",
      ),
    ).toBeTruthy();
    expect((await (await fetch(`${route}/search?q=sample`)).json()).hits[0].path).toBe("sample.ts");
    expect((await (await fetch(`${route}/git`)).json()).available).toBe(false);
    const save = (body, origin = base) =>
      fetch(`${route}/file`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Origin: origin },
        body: JSON.stringify(body),
      });
    expect(
      (
        await save(
          { path: "sample.md", original: "# Original\n", content: "# Saved\n" },
          "https://foreign.test",
        )
      ).status,
    ).toBe(403);
    expect((await save({ path: "sample.md", content: "# Saved\n" })).status).toBe(400);
    const saved = await save({ path: "sample.md", original: "# Original\n", content: "# Saved\n" });
    expect(saved.status).toBe(200);
    expect(saved.headers.get("cache-control")).toBe("no-store");
    expect(await readFile(join(directory, "sample.md"), "utf8")).toBe("# Saved\n");
    expect(
      (await save({ path: "sample.md", original: "# Original\n", content: "stale" })).status,
    ).toBe(409);
    expect((await fetch(`${route}/file?path=../outside`)).status).toBe(403);
    expect(
      (await fetch(`${route}/file?path=sample.ts`, { headers: { Origin: "https://foreign.test" } }))
        .status,
    ).toBe(403);
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
    expect(foreignStatus).toBe(403);
    const folders = `${base}/api/directories?${new URLSearchParams({ path: directory })}`;
    const folderResponse = await fetch(folders);
    expect(folderResponse.status).toBe(200);
    expect(folderResponse.headers.get("cache-control")).toBe("no-store");
    expect((await folderResponse.json()).entries).toStrictEqual([
      { name: "projector", path: join(directory, "projector") },
    ]);
    expect((await fetch(folders, { headers: { Origin: "https://foreign.test" } })).status).toBe(
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
    expect(foreignFolder).toBe(403);
    expect((await fetch(`${base}/api/projects/missing/workspace/tree`)).status).toBe(404);
    const entry = (body, origin = base) =>
      fetch(`${route}/entry`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: origin },
        body: JSON.stringify(body),
      });
    const creation = { action: "create-file", path: "", directory: "", name: "created.md" };
    expect((await entry(creation, "https://foreign.test")).status).toBe(403);
    expect((await entry({ action: "delete" })).status).toBe(400);
    expect((await entry(creation)).status).toBe(200);
    expect((await entry(creation)).status).toBe(409);
    expect(
      (await entry({ ...creation, action: "rename", path: "created.md", name: "renamed.md" }))
        .status,
    ).toBe(200);
    expect((await entry({ ...creation, action: "delete", path: "renamed.md" })).status).toBe(200);
    expect((await fetch(`${route}/root`)).status).toBe(200);
    const move = (body, origin = base) =>
      fetch(`${route}/move`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: origin },
        body: JSON.stringify(body),
      });
    expect(
      (await move({ path: "sample.ts", directory: "projector" }, "https://foreign.test")).status,
    ).toBe(403);
    expect((await move({ directory: "projector" })).status).toBe(400);
    expect((await move({ path: "../sample.ts", directory: "projector" })).status).toBe(403);
    const moved = await move({ path: "sample.ts", directory: "projector" });
    expect(moved.status).toBe(200);
    expect(moved.headers.get("cache-control")).toBe("no-store");
    expect(await moved.json()).toStrictEqual({
      source: "sample.ts",
      destination: "projector/sample.ts",
    });
    expect((await fetch(`${route}/file?path=projector/sample.ts`)).status).toBe(200);
    expect((await fetch(`${route}/file?path=sample.ts`)).status).toBe(400);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
    await rm(externalDirectory, { recursive: true, force: true });
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
    expect(listing.path).toBe(base);
    expect(listing.entries.map((row) => row.name)).toStrictEqual([
      ".hidden",
      "alias",
      "alpha",
      "alphabet",
      "with space",
    ]);
    const completions = await listDirectories(`${base}/alph`, true);
    expect(completions.entries.map((row) => row.path)).toStrictEqual([
      join(base, "alpha"),
      join(base, "alphabet"),
    ]);
    expect((await listDirectories(`${base}/`, true)).entries.length).toBe(5);
    expect((await listDirectories(join(base, "with space"))).entries.length).toBe(0);
    await expect(listDirectories("relative/path")).rejects.toMatchObject({ status: 400 });
    await expect(listDirectories(`${base}\0`)).rejects.toMatchObject({ status: 400 });
    await expect(listDirectories(join(base, "a-file"))).rejects.toMatchObject({ status: 400 });
    await expect(listDirectories(join(base, "missing"))).rejects.toMatchObject({ status: 400 });
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("Git tree backgrounds aggregate nested changes, renames, deletions and conflicts without prefix collisions", async () => {
  const { gitTreeDecorations } = await import("../core/modules/workspace/index.ts");
  const change = (path, index = " ", worktree = "M", originalPath) => ({
    path,
    index,
    worktree,
    originalPath,
  });
  const changes = [
    change("src/deep/edit.ts"),
    change("src/new.ts", "?", "?"),
    change("src-other/clean.ts", " ", " "),
    change("new/folder/file.txt", "A", "M"),
    change("deleted/old.txt", "D", " "),
    change("destination/moved.ts", "R", " ", "source/moved.ts"),
    change("conflicts/a.txt", "U", "U"),
    change("conflicts/b.txt", "?", "?"),
    change("ignored/file", "!", "!"),
  ];
  const before = structuredClone(changes);
  const decorations = gitTreeDecorations(changes);
  expect(decorations.get("src")).toBe("modified");
  expect(decorations.get("src/deep")).toBe("modified");
  expect(decorations.get("src/deep/edit.ts")).toBe("modified");
  expect(decorations.get("src/new.ts")).toBe("added");
  expect(decorations.has("src-other")).toBe(false);
  expect(decorations.get("new/folder")).toBe("added");
  expect(decorations.get("deleted")).toBe("deleted");
  expect(decorations.get("source")).toBe("deleted");
  expect(decorations.get("destination")).toBe("modified");
  expect(decorations.get("conflicts")).toBe("conflict");
  expect(decorations.has("ignored")).toBe(false);
  expect(gitTreeDecorations([change("file", "A", "A")]).get("file")).toBe("conflict");
  expect(gitTreeDecorations([change("file", "D", "D")]).get("file")).toBe("conflict");
  expect(gitTreeDecorations([]).size).toBe(0);
  expect(changes).toStrictEqual(before);
});

test("Git actions preserve staged content, handle deleted/literal paths and trash untracked files", async () => {
  const base = await mkdtemp(join(tmpdir(), "projector-git-actions-"));
  const run = (...args) => execFileSync("git", ["-C", base, ...args], { encoding: "utf8" });
  try {
    run("init", "-q");
    run("config", "user.name", "Test");
    run("config", "user.email", "test@example.test");
    await writeFile(join(base, "file.txt"), "head");
    await writeFile(join(base, "other.txt"), "head");
    run("add", ".");
    run("commit", "-qm", "initial");
    await writeFile(join(base, "file.txt"), "index");
    await mutateProjectGit(base, "stage", "file.txt");
    await writeFile(join(base, "file.txt"), "working");
    const partial = await projectGit(base);
    expect(partial.changes.find((c) => c.path === "file.txt").index).toBe("M");
    expect(partial.changes.find((c) => c.path === "file.txt").worktree).toBe("M");
    await mutateProjectGit(base, "discard", "file.txt");
    expect(await readFile(join(base, "file.txt"), "utf8")).toBe("index");
    expect(run("show", ":file.txt")).toBe("index");
    await mutateProjectGit(base, "unstage", "file.txt");
    expect(run("show", ":file.txt")).toBe("head");
    expect(await readFile(join(base, "file.txt"), "utf8")).toBe("index");
    await rm(join(base, "file.txt"));
    await mutateProjectGit(base, "discard", "file.txt");
    expect(await readFile(join(base, "file.txt"), "utf8")).toBe("head");
    await rm(join(base, "file.txt"));
    await mutateProjectGit(base, "stage", "file.txt");
    expect((await projectGit(base)).changes.find((c) => c.path === "file.txt").index).toBe("D");
    await mutateProjectGit(base, "unstage", "file.txt");
    await mutateProjectGit(base, "discard", "file.txt");
    await writeFile(join(base, "[literal].txt"), "new");
    await writeFile(join(base, "literal.txt"), "other");
    await mutateProjectGit(base, "stage", "[literal].txt");
    expect((await projectGit(base)).changes.find((c) => c.path === "literal.txt").index).toBe("?");
    await mutateProjectGit(base, "unstage", "[literal].txt");
    await mutateProjectGit(base, "discard", "[literal].txt");
    expect(
      (await readdir(join(base, ".projector-trash"))).some((name) =>
        name.endsWith("-[literal].txt"),
      ),
    ).toBeTruthy();
    run("mv", "other.txt", "renamed.txt");
    await mutateProjectGit(base, "unstage", "renamed.txt");
    expect(run("diff", "--cached")).toBe("");
    expect(await readFile(join(base, "renamed.txt"), "utf8")).toBe("head");
    for (const path of ["", "../outside", ".git/config", "a/../file.txt"])
      await expect(mutateProjectGit(base, "stage", path)).rejects.toMatchObject({ status: 403 });
    await expect(mutateProjectGit(base, "reset", "literal.txt")).rejects.toMatchObject({
      status: 400,
    });
    await symlink(outside, join(base, "escape"));
    await expect(mutateProjectGit(base, "stage", "escape")).rejects.toMatchObject({
      status: 403,
    });
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("Git unstage works before the first commit, and index writes serialize", async () => {
  const base = await mkdtemp(join(tmpdir(), "projector-git-unborn-"));
  const run = (...args) => execFileSync("git", ["-C", base, ...args], { encoding: "utf8" });
  try {
    run("init", "-q");
    await writeFile(join(base, "a.txt"), "a");
    await writeFile(join(base, "b.txt"), "b");
    await Promise.all([
      mutateProjectGit(base, "stage", "a.txt"),
      mutateProjectGit(base, "stage", "b.txt"),
    ]);
    expect(run("ls-files").trim()).toBe("a.txt\nb.txt");
    await writeFile(join(base, "a.txt"), "modified");
    await mutateProjectGit(base, "unstage", "a.txt");
    expect(run("ls-files").trim()).toBe("b.txt");
    expect(await readFile(join(base, "a.txt"), "utf8")).toBe("modified");
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("Git mutations stay within nested projects and reject conflict discard", async () => {
  const base = await mkdtemp(join(tmpdir(), "projector-git-nested-"));
  const run = (...args) => execFileSync("git", ["-C", base, ...args], { encoding: "utf8" });
  try {
    run("init", "-q");
    run("config", "user.name", "Test");
    run("config", "user.email", "test@example.test");
    await mkdir(join(base, "nested"));
    await writeFile(join(base, "outside.txt"), "outside");
    await writeFile(join(base, "nested/inside.txt"), "inside");
    run("add", ".");
    run("commit", "-qm", "initial");
    await writeFile(join(base, "outside.txt"), "changed outside");
    await writeFile(join(base, "nested/inside.txt"), "changed inside");
    await Promise.all([
      mutateProjectGit(join(base, "nested"), "stage", "inside.txt"),
      mutateProjectGit(base, "stage", "outside.txt"),
    ]);
    await mutateProjectGit(join(base, "nested"), "unstage", "inside.txt");
    expect(run("diff", "--cached", "--name-only").trim()).toBe("outside.txt");
    await mutateProjectGit(join(base, "nested"), "discard", "inside.txt");
    expect(await readFile(join(base, "nested/inside.txt"), "utf8")).toBe("inside");
    expect(await readFile(join(base, "outside.txt"), "utf8")).toBe("changed outside");
    await rm(join(base, "nested"), { recursive: true });
    await mutateProjectGit(base, "discard", "nested/inside.txt");
    expect(await readFile(join(base, "nested/inside.txt"), "utf8")).toBe("inside");
    const blob = run("rev-parse", "HEAD:nested/inside.txt").trim();
    execFileSync("git", ["-C", base, "update-index", "--index-info"], {
      input: `0 ${"0".repeat(40)}\tnested/inside.txt\n100644 ${blob} 1\tnested/inside.txt\n100644 ${blob} 2\tnested/inside.txt\n100644 ${blob} 3\tnested/inside.txt\n`,
    });
    await expect(mutateProjectGit(base, "discard", "nested/inside.txt")).rejects.toMatchObject({
      status: 409,
    });
    await expect(mutateProjectGit(base, "unstage", "nested/inside.txt")).rejects.toMatchObject({
      status: 409,
    });
    await mutateProjectGit(base, "stage", "nested/inside.txt");
    expect(run("ls-files", "--unmerged")).toBe("");
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("Git batch actions validate the whole selection and preserve working contents", async () => {
  const base = await mkdtemp(join(tmpdir(), "projector-git-batch-"));
  const run = (...args) => execFileSync("git", ["-C", base, ...args], { encoding: "utf8" });
  try {
    run("init", "-q");
    run("config", "user.name", "Test");
    run("config", "user.email", "test@example.test");
    await mkdir(join(base, "folder"));
    for (const path of ["folder/a.txt", "folder/b.txt", "outside.txt"])
      await writeFile(join(base, path), "head");
    run("add", ".");
    run("commit", "-qm", "initial");
    await writeFile(join(base, "folder/a.txt"), "changed a");
    await rm(join(base, "folder/b.txt"));
    await writeFile(join(base, "folder/new.txt"), "new");
    await writeFile(join(base, "outside.txt"), "outside");
    await expect(
      mutateProjectGit(base, "stage", ["folder/a.txt", "missing.txt"]),
    ).rejects.toMatchObject({
      status: 404,
    });
    expect(run("diff", "--cached")).toBe("");
    await expect(
      mutateProjectGit(base, "stage", ["folder/a.txt", "../outside"]),
    ).rejects.toMatchObject({
      status: 403,
    });
    await expect(mutateProjectGit(base, "stage", [])).rejects.toMatchObject({ status: 400 });
    await mutateProjectGit(base, "stage", ["folder/a.txt", "folder/b.txt", "folder/new.txt"]);
    expect(run("diff", "--cached", "--name-only").trim()).toBe(
      "folder/a.txt\nfolder/b.txt\nfolder/new.txt",
    );
    await writeFile(join(base, "folder/a.txt"), "partially staged");
    await mutateProjectGit(base, "unstage", ["folder/a.txt", "folder/b.txt", "folder/new.txt"]);
    expect(run("diff", "--cached")).toBe("");
    expect(await readFile(join(base, "folder/a.txt"), "utf8")).toBe("partially staged");
    expect(await readFile(join(base, "folder/new.txt"), "utf8")).toBe("new");
    expect(await readFile(join(base, "outside.txt"), "utf8")).toBe("outside");
    expect((await projectGit(base)).changes.find((c) => c.path === "folder/b.txt").worktree).toBe(
      "D",
    );
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("githubRepositoryFromRemote accepts GitHub remotes and rejects the rest", () => {
  const cases = [
    ["https://github.com/Sdju/projector.git", "Sdju/projector"],
    ["https://github.com/Sdju/projector", "Sdju/projector"],
    ["git@github.com:Sdju/projector.git", "Sdju/projector"],
    ["ssh://git@github.com/Sdju/projector.git", "Sdju/projector"],
    ["ssh://git@github.com:22/Sdju/projector", "Sdju/projector"],
    ["git://github.com/Sdju/projector.git", "Sdju/projector"],
    ["https://github.com/Sdju/projector/", "Sdju/projector"],
    ["ssh://git@ssh.github.com:443/Sdju/projector.git", "Sdju/projector"],
    ["https://gitlab.com/Sdju/projector.git", null],
    ["git@gitlab.com:Sdju/projector.git", null],
    ["git@github.com:owner/../escape", null],
    ["", null],
  ];
  for (const [remote, expected] of cases)
    expect(githubRepositoryFromRemote(remote), remote).toBe(expected);
});

test("projectGithubRepository reads a local project's GitHub origin", async () => {
  const base = await mkdtemp(join(tmpdir(), "projector-remote-"));
  const run = (...args) => execFileSync("git", ["-C", base, ...args], { encoding: "utf8" });
  try {
    run("init", "-q");
    expect(await projectGithubRepository(base)).toBe(null);
    run("remote", "add", "origin", "git@github.com:Sdju/projector.git");
    expect(await projectGithubRepository(base)).toBe("Sdju/projector");
    run("remote", "set-url", "origin", "https://gitlab.com/Sdju/projector.git");
    expect(await projectGithubRepository(base)).toBe(null);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});
