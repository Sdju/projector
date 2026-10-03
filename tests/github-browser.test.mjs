import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { githubProjectRoute } from "../core/modules/github/index.ts";
import { projectRoute } from "../src/modules/project/project-route.ts";
import { parseProjectRef, projectRefSegments } from "../core/modules/project/index.ts";

const projectPathSegments = (path) => projectRefSegments(parseProjectRef(path));

test("GitHub paths use gh:/ in the segmented path and a dedicated browser route", () => {
  assert.equal(projectRoute("gh:/octocat/Hello-World"), "/gh/projects/octocat/Hello-World");
  assert.equal(
    githubProjectRoute("https://github.com/octocat/Hello-World.git"),
    "/gh/projects/octocat/Hello-World",
  );
  assert.deepEqual(projectPathSegments("gh:/octocat/Hello-World"), [
    { name: "gh:/", path: "gh:/" },
    { name: "octocat", path: "gh:/octocat" },
    { name: "Hello-World", path: "gh:/octocat/Hello-World" },
  ]);
  assert.deepEqual(projectPathSegments("/tmp/repo"), [
    { name: "/", path: "/" },
    { name: "tmp", path: "/tmp" },
    { name: "repo", path: "/tmp/repo" },
  ]);
  for (const path of ["../repo", "owner/..", "owner/repo/extra", "https://evil.test/a/b"])
    assert.throws(() => githubProjectRoute(path));
});

test("readonly GitHub browser reads snapshots, trees and blobs without cloning or persisting projects", async () => {
  const root = await mkdtemp(join(tmpdir(), "projector-gh-browser-"));
  process.env.XDG_DATA_HOME = root;
  const api = await import("../server/modules/integrations/index.ts");
  const sha = "a".repeat(40);
  const tree = "b".repeat(40);
  let mode = "normal";
  const requests = [];
  let authorized = false;
  const fetch = mock.method(globalThis, "fetch", async (address, init) => {
    const url = new URL(address);
    requests.push(url.pathname);
    assert.equal(url.origin, "https://api.github.com");
    assert.equal(init.headers.Authorization, authorized ? "Bearer test-secret" : undefined);
    assert.equal(init.method, undefined);
    assert.equal(init.redirect, "error");
    if (mode === "missing") return Response.json({}, { status: 404 });
    if (mode === "limit") return Response.json({}, { status: 403 });
    if (url.pathname === "/repos/octocat/repo")
      return Response.json({
        full_name: "octocat/repo",
        description: "Demo",
        default_branch: "main",
        private: false,
        size: 0,
      });
    if (url.pathname.includes("/commits/")) {
      if (mode === "empty") return Response.json({}, { status: 409 });
      return Response.json({ sha, commit: { tree: { sha: tree } } });
    }
    if (url.pathname.includes("/git/trees/"))
      return Response.json({
        tree: [
          { path: "README.md", type: "blob", mode: "100644", sha, size: 7 },
          { path: "src", type: "tree", mode: "040000", sha: tree },
          { path: "image.png", type: "blob", mode: "100644", sha, size: 7 },
        ],
        truncated: mode === "truncated",
      });
    const bytes = mode === "binary" ? Buffer.from([0, 255, 0]) : Buffer.from("# Hello");
    return Response.json({
      encoding: "base64",
      size: mode === "large" ? 6 * 1024 * 1024 : bytes.length,
      content: bytes.toString("base64"),
    });
  });
  try {
    const repo = await api.browseGithubRepository("octocat/repo");
    assert.equal(repo.commit, sha);
    assert.equal(repo.tree, tree);
    assert.equal(repo.empty, false);
    await api.browseGithubRepository("octocat/repo", "feature/test");
    assert.ok(requests.at(-1).endsWith("/feature%2Ftest"));
    const directory = await api.browseGithubTree("octocat/repo", tree);
    assert.equal(directory.entries[0].name, "src");
    assert.ok(directory.entries.some((entry) => entry.name === "README.md"));
    const file = await api.browseGithubFile("octocat/repo", sha, "README.md");
    assert.equal(file.content, "# Hello");
    assert.equal(file.binary, false);
    mode = "binary";
    assert.equal((await api.browseGithubFile("octocat/repo", sha, "data.bin")).binary, true);
    const image = await api.browseGithubFile("octocat/repo", sha, "image.png");
    assert.ok(image.image.startsWith("data:image/png;base64,"));
    mode = "large";
    await assert.rejects(api.browseGithubFile("octocat/repo", sha, "large.txt"), { status: 413 });
    mode = "empty";
    assert.equal((await api.browseGithubRepository("octocat/repo")).empty, true);
    await assert.rejects(api.browseGithubRepository("octocat/repo", "missing"), { status: 409 });
    mode = "truncated";
    assert.equal((await api.browseGithubTree("octocat/repo", tree)).truncated, true);
    mode = "missing";
    await assert.rejects(api.browseGithubRepository("octocat/repo"), { status: 404 });
    mode = "limit";
    await assert.rejects(api.browseGithubRepository("octocat/repo"), { status: 403 });
    const count = requests.length;
    await assert.rejects(api.browseGithubTree("octocat/repo", "../../evil"), { status: 400 });
    await assert.rejects(api.browseGithubRepository("owner/repo/../other"), { status: 400 });
    assert.equal(requests.length, count);
    assert.deepEqual(await readdir(root), []);
    mode = "normal";
    const asset = await api.browseGithubAsset("octocat/repo", tree, "src/image.png");
    assert.equal(asset.mime, "image/png");
    assert.equal(asset.bytes.toString(), "# Hello");
    await assert.rejects(api.browseGithubAsset("octocat/repo", tree, "missing.png"), {
      status: 404,
    });
    await assert.rejects(api.browseGithubAsset("octocat/repo", tree, "../image.png"), {
      status: 400,
    });
    await api.updateIntegration("github", (config) => ({
      ...config,
      enabled: true,
      credentials: { token: "test-secret", login: "octocat" },
    }));
    authorized = true;
    const privateRepo = await api.browseGithubRepository("octocat/repo");
    assert.ok(!JSON.stringify(privateRepo).includes("test-secret"));
    await api.updateIntegration("github", (config) => ({ ...config, enabled: false }));
    authorized = false;
    await api.browseGithubRepository("octocat/repo");
  } finally {
    fetch.mock.restore();
    await rm(root, { recursive: true, force: true });
  }
});
