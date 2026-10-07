import assert from "node:assert/strict";
import { test } from "node:test";
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

test("image zoom keeps the cursor anchor fixed, including at zoom limits", () => {
  const initial = { zoom: 2, x: 40, y: -30 };
  const anchor = { x: 130, y: 75 };
  for (const requested of [0.0001, 0.5, 4, 100]) {
    const next = zoomImageAt(initial, requested, anchor.x, anchor.y);
    assert.ok(next.zoom >= 1 / 64 && next.zoom <= 32);
    assert.equal((anchor.x - next.x) / next.zoom, (anchor.x - initial.x) / initial.zoom);
    assert.equal((anchor.y - next.y) / next.zoom, (anchor.y - initial.y) / initial.zoom);
  }
  assert.equal(fitImage(2000, 1000, 1048, 548), 0.5);
  assert.equal(fitImage(200, 100, 1048, 548), 5);
  assert.equal(fitImage(20, 10, 1048, 548), 32);
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
    assert.equal(stopped.zoom, 1);
    assert.equal((120 - stopped.x) / stopped.zoom, (120 - original.x) / original.zoom);
    assert.equal((60 - stopped.y) / stopped.zoom, (60 - original.y) / original.zoom);
    assert.equal(zoomImageAt(stopped, requested, 120, 60).zoom, requested);
  }
  assert.equal(zoomImageAt({ zoom: 0.5, x: 0, y: 0 }, 0.75, 0, 0).zoom, 0.75);
});
test("file drops preserve external contents and distinguish project paths", async () => {
  assert.equal(projectRelativePath("/tmp/project", "/tmp/project/README.md"), "README.md");
  assert.equal(projectRelativePath("/tmp/project/", "/tmp/project/src/file.ts"), "src/file.ts");
  assert.equal(projectRelativePath("/tmp/project", "/tmp/project-other/file.ts"), undefined);
  const file = new File(["# External\n"], "external.md");
  assert.deepEqual(await previewBrowserFile(file), {
    path: "external.md",
    content: "# External\n",
  });
  await assert.rejects(previewBrowserFile(new File(["a\0b"], "binary.bin")), /Бинарный файл/);
  await assert.rejects(
    previewBrowserFile(new File([new Uint8Array(1024 * 1024 + 1)], "large.txt")),
    /больше 1 МБ/,
  );
  const svg = "<svg xmlns='http://www.w3.org/2000/svg'/>";
  assert.deepEqual(await previewBrowserFile(new File([svg], "external.SVG")), {
    path: "external.SVG",
    content: svg,
  });
  const image = await previewBrowserFile(
    new File([new Uint8Array([137, 80, 78, 71])], "external.png"),
  );
  assert.ok(image.image.startsWith("blob:"));
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
    assert.deepEqual(await mutateProjectEntry(base, "rename", "folder/note.md", "", "new.md"), {
      source: "folder/note.md",
      destination: "folder/new.md",
    });
    await mutateProjectEntry(base, "copy", "folder", "", "copy");
    assert.equal(await readFile(join(base, "copy/new.md"), "utf8"), "draft");
    for (const action of ["create-file", "create-directory", "copy"])
      await assert.rejects(mutateProjectEntry(base, action, "folder", "", "copy"), { status: 409 });
    await assert.rejects(mutateProjectEntry(base, "copy", "folder", "folder", "child"), {
      status: 400,
    });
    await mutateProjectEntry(base, "create-file", "", "folder", "other.md");
    await assert.rejects(mutateProjectEntry(base, "rename", "folder/new.md", "", "other.md"), {
      status: 409,
    });
    await symlink(base, join(base, "alias"));
    for (const action of ["rename", "delete", "copy"])
      for (const path of ["", "../outside", "alias", "alias/folder", ".git/config"])
        await assert.rejects(mutateProjectEntry(base, action, path, "", "valid"), { status: 403 });
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
      await assert.rejects(mutateProjectEntry(base, "create-file", "", "", name), { status: 400 });
    await assert.rejects(mutateProjectEntry(base, "create-file", "", "alias", "valid"), {
      status: 403,
    });
    execFileSync("git", ["-C", base, "init", "-q"]);
    await mutateProjectEntry(base, "delete", "folder");
    const trashed = await readdir(join(base, ".projector-trash"));
    assert.equal(trashed.length, 1);
    assert.ok(
      (await projectGit(base)).changes.every((change) => !change.path.includes(".projector-trash")),
    );
    assert.equal(
      await readFile(join(base, ".projector-trash", trashed[0], "new.md"), "utf8"),
      "draft",
    );
    assert.deepEqual(
      (await listProjectDirectory(base)).entries.map((entry) => entry.name),
      ["copy"],
    );
    await rm(join(base, ".projector-trash"), { recursive: true });
    await symlink(tmpdir(), join(base, ".projector-trash"));
    await assert.rejects(mutateProjectEntry(base, "delete", "copy"), { status: 403 });
    assert.equal(await readFile(join(base, "copy/new.md"), "utf8"), "draft");
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});
test("Text file saves preserve text and mode, reject stale drafts and contain writes", async () => {
  const base = await mkdtemp(join(tmpdir(), "projector-markdown-"));
  try {
    await writeFile(join(base, "readme.md"), "# Original\r\n", { mode: 0o640 });
    await saveProjectFile(base, "readme.md", "# Новый текст\r\n", "# Original\r\n");
    assert.equal(await readFile(join(base, "readme.md"), "utf8"), "# Новый текст\r\n");
    assert.equal((await lstat(join(base, "readme.md"))).mode & 0o777, 0o640);
    await assert.rejects(saveProjectFile(base, "readme.md", "stale", "# Original\r\n"), {
      status: 409,
    });
    const competing = await Promise.allSettled([
      saveProjectFile(base, "readme.md", "first", "# Новый текст\r\n"),
      saveProjectFile(base, "readme.md", "second", "# Новый текст\r\n"),
    ]);
    assert.equal(competing.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(competing.find((result) => result.status === "rejected").reason.status, 409);
    await symlink(join(base, "readme.md"), join(base, "alias.md"));
    await mkdir(join(base, ".git"));
    await writeFile(join(base, ".git/config.md"), "protected");
    for (const path of ["../outside.md", "/tmp/outside.md", "alias.md", ".git/config.md"])
      await assert.rejects(saveProjectFile(base, path, "test", ""), { status: 403 });
    for (const path of ["plain.ts", "settings.json", ".gitignore", "LICENSE"]) {
      await writeFile(join(base, path), "original\r\n", { mode: 0o750 });
      await saveProjectFile(base, path, "Изменено\r\n", "original\r\n");
      assert.equal(await readFile(join(base, path), "utf8"), "Изменено\r\n");
      assert.equal((await lstat(join(base, path))).mode & 0o777, 0o750);
      await assert.rejects(saveProjectFile(base, path, "stale", "original\r\n"), { status: 409 });
    }
    await writeFile(join(base, "binary.bin"), Buffer.from([0, 1]));
    await assert.rejects(saveProjectFile(base, "binary.bin", "text", ""), { status: 415 });
    await assert.rejects(saveProjectFile(base, "readme.md", "\0", "first"), { status: 415 });
    await assert.rejects(saveProjectFile(base, "readme.md", "x".repeat(1024 * 1024 + 1), ""), {
      status: 413,
    });
    await writeFile(join(base, "picture.png"), Buffer.from([137, 80, 78, 71]));
    const image = await readProjectImage(base, "picture.png");
    assert.equal(image.type, "image/png");
    assert.deepEqual(image.content, Buffer.from([137, 80, 78, 71]));
    assert.deepEqual(await previewProjectFile(base, "picture.png"), {
      path: "picture.png",
      content: "",
      image: true,
    });
    await assert.rejects(readProjectImage(base, "readme.md"), { status: 415 });
    await assert.rejects(readProjectImage(base, "../picture.png"), { status: 403 });
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});
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
  await withDefaultExcludes(async () => {
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
});

test("files exclude setting controls tree visibility for node_modules", async () => {
  const root = await mkdtemp(join(tmpdir(), "projector-exclude-project-"));
  try {
    await mkdir(join(root, "node_modules"));
    await writeFile(join(root, "readme.md"), "hi");
    await withFilesExclude(defaultFilesExclude(), async () => {
      assert.ok(
        !(await listProjectDirectory(root)).entries.some((entry) => entry.name === "node_modules"),
      );
      const next = { ...defaultFilesExclude() };
      delete next["**/node_modules"];
      await withFilesExclude(next, async () => {
        assert.ok(
          (await listProjectDirectory(root)).entries.some((entry) => entry.name === "node_modules"),
        );
      });
      assert.ok(
        !(await listProjectDirectory(root)).entries.some((entry) => entry.name === "node_modules"),
      );
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

    assert.deepEqual(await projectGutter(base, "committed.txt"), {
      available: true,
      original: "staged\n",
    });
    assert.deepEqual(await projectGutter(join(base, "sub"), "nested.txt"), {
      available: true,
      original: "nested\n",
    });
    assert.deepEqual(await projectGutter(base, "untracked.txt"), {
      available: false,
      original: "",
    });
    await assert.rejects(projectGutter(base, "../outside"), { status: 403 });

    const plain = await mkdtemp(join(tmpdir(), "projector-gutter-plain-"));
    try {
      await writeFile(join(plain, "file.txt"), "content\n");
      assert.deepEqual(await projectGutter(plain, "file.txt"), { available: false, original: "" });
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
    assert.equal(external.status, 200);
    assert.deepEqual(await external.json(), {
      path: externalPath,
      content: "External file contents\n",
    });
    assert.equal((await fetch(`${route}/external?path=relative.txt`)).status, 400);
    assert.equal(
      (
        await fetch(`${route}/external?path=${encodeURIComponent(externalPath)}`, {
          headers: { Origin: "https://foreign.test" },
        })
      ).status,
      403,
    );
    const imagePath = join(externalDirectory, "outside.svg");
    const imagePreview = await (
      await fetch(`${route}/external?path=${encodeURIComponent(imagePath)}`)
    ).json();
    assert.deepEqual(imagePreview, {
      path: imagePath,
      content: "<svg xmlns='http://www.w3.org/2000/svg'/>",
    });
    const image = await fetch(`${route}/external-asset?path=${encodeURIComponent(imagePath)}`);
    assert.equal(image.headers.get("content-type"), "image/svg+xml");
    assert.equal(image.headers.get("x-content-type-options"), "nosniff");
    assert.match(await image.text(), /<svg/);
    const file = await fetch(`${route}/file?path=sample.ts`);
    assert.equal(file.status, 200);
    assert.equal(file.headers.get("cache-control"), "no-store");
    assert.equal((await file.json()).content, "const sample = true;\n");
    const archive = await fetch(`${route}/file?path=sample.ts.gz`);
    assert.equal(archive.status, 200);
    assert.equal(archive.headers.get("cache-control"), "no-store");
    const preview = await archive.json();
    assert.equal(preview.archive.format, "GZIP");
    assert.deepEqual(preview.archive.entries, [{ path: "sample.ts", type: "file", size: 21 }]);
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
    const save = (body, origin = base) =>
      fetch(`${route}/file`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Origin: origin },
        body: JSON.stringify(body),
      });
    assert.equal(
      (
        await save(
          { path: "sample.md", original: "# Original\n", content: "# Saved\n" },
          "https://foreign.test",
        )
      ).status,
      403,
    );
    assert.equal((await save({ path: "sample.md", content: "# Saved\n" })).status, 400);
    const saved = await save({ path: "sample.md", original: "# Original\n", content: "# Saved\n" });
    assert.equal(saved.status, 200);
    assert.equal(saved.headers.get("cache-control"), "no-store");
    assert.equal(await readFile(join(directory, "sample.md"), "utf8"), "# Saved\n");
    assert.equal(
      (await save({ path: "sample.md", original: "# Original\n", content: "stale" })).status,
      409,
    );
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
    const entry = (body, origin = base) =>
      fetch(`${route}/entry`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: origin },
        body: JSON.stringify(body),
      });
    const creation = { action: "create-file", path: "", directory: "", name: "created.md" };
    assert.equal((await entry(creation, "https://foreign.test")).status, 403);
    assert.equal((await entry({ action: "delete" })).status, 400);
    assert.equal((await entry(creation)).status, 200);
    assert.equal((await entry(creation)).status, 409);
    assert.equal(
      (await entry({ ...creation, action: "rename", path: "created.md", name: "renamed.md" }))
        .status,
      200,
    );
    assert.equal((await entry({ ...creation, action: "delete", path: "renamed.md" })).status, 200);
    assert.equal((await fetch(`${route}/root`)).status, 200);
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
  assert.equal(decorations.get("src"), "modified");
  assert.equal(decorations.get("src/deep"), "modified");
  assert.equal(decorations.get("src/deep/edit.ts"), "modified");
  assert.equal(decorations.get("src/new.ts"), "added");
  assert.equal(decorations.has("src-other"), false);
  assert.equal(decorations.get("new/folder"), "added");
  assert.equal(decorations.get("deleted"), "deleted");
  assert.equal(decorations.get("source"), "deleted");
  assert.equal(decorations.get("destination"), "modified");
  assert.equal(decorations.get("conflicts"), "conflict");
  assert.equal(decorations.has("ignored"), false);
  assert.equal(gitTreeDecorations([change("file", "A", "A")]).get("file"), "conflict");
  assert.equal(gitTreeDecorations([change("file", "D", "D")]).get("file"), "conflict");
  assert.equal(gitTreeDecorations([]).size, 0);
  assert.deepEqual(changes, before);
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
    assert.equal(partial.changes.find((c) => c.path === "file.txt").index, "M");
    assert.equal(partial.changes.find((c) => c.path === "file.txt").worktree, "M");
    await mutateProjectGit(base, "discard", "file.txt");
    assert.equal(await readFile(join(base, "file.txt"), "utf8"), "index");
    assert.equal(run("show", ":file.txt"), "index");
    await mutateProjectGit(base, "unstage", "file.txt");
    assert.equal(run("show", ":file.txt"), "head");
    assert.equal(await readFile(join(base, "file.txt"), "utf8"), "index");
    await rm(join(base, "file.txt"));
    await mutateProjectGit(base, "discard", "file.txt");
    assert.equal(await readFile(join(base, "file.txt"), "utf8"), "head");
    await rm(join(base, "file.txt"));
    await mutateProjectGit(base, "stage", "file.txt");
    assert.equal((await projectGit(base)).changes.find((c) => c.path === "file.txt").index, "D");
    await mutateProjectGit(base, "unstage", "file.txt");
    await mutateProjectGit(base, "discard", "file.txt");
    await writeFile(join(base, "[literal].txt"), "new");
    await writeFile(join(base, "literal.txt"), "other");
    await mutateProjectGit(base, "stage", "[literal].txt");
    assert.equal((await projectGit(base)).changes.find((c) => c.path === "literal.txt").index, "?");
    await mutateProjectGit(base, "unstage", "[literal].txt");
    await mutateProjectGit(base, "discard", "[literal].txt");
    assert.ok(
      (await readdir(join(base, ".projector-trash"))).some((name) =>
        name.endsWith("-[literal].txt"),
      ),
    );
    run("mv", "other.txt", "renamed.txt");
    await mutateProjectGit(base, "unstage", "renamed.txt");
    assert.equal(run("diff", "--cached"), "");
    assert.equal(await readFile(join(base, "renamed.txt"), "utf8"), "head");
    for (const path of ["", "../outside", ".git/config", "a/../file.txt"])
      await assert.rejects(mutateProjectGit(base, "stage", path), { status: 403 });
    await assert.rejects(mutateProjectGit(base, "reset", "literal.txt"), { status: 400 });
    await symlink("/tmp", join(base, "escape"));
    await assert.rejects(mutateProjectGit(base, "stage", "escape"), { status: 403 });
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
    assert.equal(run("ls-files").trim(), "a.txt\nb.txt");
    await writeFile(join(base, "a.txt"), "modified");
    await mutateProjectGit(base, "unstage", "a.txt");
    assert.equal(run("ls-files").trim(), "b.txt");
    assert.equal(await readFile(join(base, "a.txt"), "utf8"), "modified");
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
    assert.equal(run("diff", "--cached", "--name-only").trim(), "outside.txt");
    await mutateProjectGit(join(base, "nested"), "discard", "inside.txt");
    assert.equal(await readFile(join(base, "nested/inside.txt"), "utf8"), "inside");
    assert.equal(await readFile(join(base, "outside.txt"), "utf8"), "changed outside");
    await rm(join(base, "nested"), { recursive: true });
    await mutateProjectGit(base, "discard", "nested/inside.txt");
    assert.equal(await readFile(join(base, "nested/inside.txt"), "utf8"), "inside");
    const blob = run("rev-parse", "HEAD:nested/inside.txt").trim();
    execFileSync("git", ["-C", base, "update-index", "--index-info"], {
      input: `0 ${"0".repeat(40)}\tnested/inside.txt\n100644 ${blob} 1\tnested/inside.txt\n100644 ${blob} 2\tnested/inside.txt\n100644 ${blob} 3\tnested/inside.txt\n`,
    });
    await assert.rejects(mutateProjectGit(base, "discard", "nested/inside.txt"), { status: 409 });
    await assert.rejects(mutateProjectGit(base, "unstage", "nested/inside.txt"), { status: 409 });
    await mutateProjectGit(base, "stage", "nested/inside.txt");
    assert.equal(run("ls-files", "--unmerged"), "");
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
    await assert.rejects(mutateProjectGit(base, "stage", ["folder/a.txt", "missing.txt"]), {
      status: 404,
    });
    assert.equal(run("diff", "--cached"), "");
    await assert.rejects(mutateProjectGit(base, "stage", ["folder/a.txt", "../outside"]), {
      status: 403,
    });
    await assert.rejects(mutateProjectGit(base, "stage", []), { status: 400 });
    await mutateProjectGit(base, "stage", ["folder/a.txt", "folder/b.txt", "folder/new.txt"]);
    assert.equal(
      run("diff", "--cached", "--name-only").trim(),
      "folder/a.txt\nfolder/b.txt\nfolder/new.txt",
    );
    await writeFile(join(base, "folder/a.txt"), "partially staged");
    await mutateProjectGit(base, "unstage", ["folder/a.txt", "folder/b.txt", "folder/new.txt"]);
    assert.equal(run("diff", "--cached"), "");
    assert.equal(await readFile(join(base, "folder/a.txt"), "utf8"), "partially staged");
    assert.equal(await readFile(join(base, "folder/new.txt"), "utf8"), "new");
    assert.equal(await readFile(join(base, "outside.txt"), "utf8"), "outside");
    assert.equal(
      (await projectGit(base)).changes.find((c) => c.path === "folder/b.txt").worktree,
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
    assert.equal(githubRepositoryFromRemote(remote), expected, remote);
});

test("projectGithubRepository reads a local project's GitHub origin", async () => {
  const base = await mkdtemp(join(tmpdir(), "projector-remote-"));
  const run = (...args) => execFileSync("git", ["-C", base, ...args], { encoding: "utf8" });
  try {
    run("init", "-q");
    assert.equal(await projectGithubRepository(base), null);
    run("remote", "add", "origin", "git@github.com:Sdju/projector.git");
    assert.equal(await projectGithubRepository(base), "Sdju/projector");
    run("remote", "set-url", "origin", "https://gitlab.com/Sdju/projector.git");
    assert.equal(await projectGithubRepository(base), null);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});
