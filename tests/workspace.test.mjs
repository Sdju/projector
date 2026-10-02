import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import {
  listProjectDirectory,
  readProjectFile,
  searchProject,
  projectGit,
  projectComparison,
} from "../server/workspace.ts";
const root = await mkdtemp(join(tmpdir(), "projector-workspace-"));
const git = (...args) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8" });
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
  const { handleApi } = await import("../server/api.ts");
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
    assert.equal((await fetch(`${base}/api/projects/missing/workspace/tree`)).status, 404);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});
