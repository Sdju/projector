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

test("GitHub history paginates filtered commits and reads exact before/after blobs", async () => {
  const root = await mkdtemp(join(tmpdir(), "projector-gh-history-"));
  process.env.XDG_DATA_HOME = root;
  const { browseGithubLog, browseGithubCommit, browseGithubComparison } =
    await import("../server/modules/integrations/index.ts");
  const head = "a".repeat(40),
    parent = "b".repeat(40);
  const remote = (index) => ({
    sha: index === 0 ? head : index.toString(16).padStart(40, "0"),
    parents: [{ sha: parent }],
    commit: {
      message: `Commit ${index}\n\nDetails`,
      author: { name: "Alice", email: "alice@test", date: "2026-10-04T00:00:00Z" },
      committer: { name: "Bob", date: "2026-10-04T01:00:00Z" },
    },
  });
  let mode = "rename";
  let total = 105;
  const requests = [];
  const fetch = mock.method(globalThis, "fetch", async (address) => {
    const url = new URL(address);
    requests.push(url);
    if (url.pathname.endsWith("/commits")) {
      const start = (Number(url.searchParams.get("page")) - 1) * 100;
      return Response.json(
        Array.from({ length: Math.max(0, Math.min(100, total - start)) }, (_, i) =>
          remote(start + i),
        ),
      );
    }
    if (url.pathname.startsWith("/repos/octocat/repo/commits/")) {
      const page = Number(url.searchParams.get("page"));
      const files =
        mode === "pages"
          ? Array.from({ length: page === 1 ? 100 : 1 }, (_, i) => ({
              filename: `file-${page}-${i}`,
              status: "added",
              additions: 1,
              deletions: 0,
            }))
          : [
              {
                filename: "new.txt",
                previous_filename: mode === "rename" ? "old.txt" : undefined,
                status: { rename: "renamed", add: "added", delete: "removed" }[mode] || "modified",
                additions: 2,
                deletions: 1,
              },
            ];
      return Response.json({
        ...remote(0),
        parents: mode === "root" ? [] : [{ sha: parent }],
        files,
      });
    }
    if (url.pathname.includes("/git/commits/"))
      return Response.json({
        tree: { sha: url.pathname.endsWith(parent) ? "c".repeat(40) : "d".repeat(40) },
      });
    if (url.pathname.includes("/git/trees/")) {
      const before = url.pathname.endsWith("c".repeat(40));
      return Response.json({
        tree: [
          {
            path: before && mode === "rename" ? "old.txt" : "new.txt",
            type: "blob",
            mode: "100644",
            sha: (before ? "e" : "f").repeat(40),
          },
        ],
        truncated: false,
      });
    }
    if (url.pathname.includes("/git/blobs/")) {
      const bytes =
        mode === "binary"
          ? Buffer.from([0, 255])
          : Buffer.from(url.pathname.endsWith("e".repeat(40)) ? "before" : "after");
      return Response.json({
        encoding: "base64",
        content: bytes.toString("base64"),
        size: bytes.length,
      });
    }
    throw new Error(`Unexpected URL: ${url}`);
  });
  try {
    const first = await browseGithubLog("octocat/repo", { sha: head, limit: "50" });
    assert.equal(first.commits.length, 50);
    assert.equal(first.next, 50);
    assert.equal(first.commits[0].refs[0].kind, "head");
    const second = await browseGithubLog("octocat/repo", { sha: head, skip: "50", limit: "50" });
    assert.equal(second.commits[0].subject, "Commit 50");
    assert.equal(second.next, 100);
    const last = await browseGithubLog("octocat/repo", { sha: head, skip: "100" });
    assert.equal(last.commits.length, 5);
    assert.equal(last.next, null);
    assert.equal(
      (await browseGithubLog("octocat/repo", { sha: head, q: "Commit 104" })).commits[0].subject,
      "Commit 104",
    );
    assert.equal(
      (await browseGithubLog("octocat/repo", { sha: head, q: "@alice" })).commits.length,
      50,
    );
    assert.equal((await browseGithubLog("octocat/repo", { sha: "" })).commits.length, 0);
    total = 605;
    const scan = await browseGithubLog("octocat/repo", { sha: head, q: "Commit 599" });
    assert.equal(scan.commits.length, 0);
    assert.equal(scan.next, 500);
    const continued = await browseGithubLog("octocat/repo", {
      sha: head,
      q: "Commit 599",
      skip: String(scan.next),
    });
    assert.equal(continued.commits[0].subject, "Commit 599");
    assert.equal(continued.next, null);
    total = 105;
    const detail = await browseGithubCommit("octocat/repo", head);
    assert.equal(detail.body, "Details");
    assert.equal(detail.files[0].status, "R");
    assert.equal(detail.files[0].originalPath, "old.txt");
    assert.equal(detail.committer, "Bob");
    assert.deepEqual(await browseGithubComparison("octocat/repo", head, "new.txt"), {
      path: "new.txt",
      original: "before",
      modified: "after",
      hash: head,
      parent: parent.slice(0, 7),
    });
    for (const next of ["add", "delete", "root"]) {
      mode = next;
      const comparison = await browseGithubComparison("octocat/repo", head, "new.txt");
      assert.equal(comparison.original, next === "delete" ? "before" : "");
      assert.equal(comparison.modified, next === "delete" ? "" : "after");
    }
    mode = "pages";
    assert.equal((await browseGithubCommit("octocat/repo", head)).files.length, 101);
    mode = "binary";
    await assert.rejects(browseGithubComparison("octocat/repo", head, "new.txt"), { status: 415 });
    await assert.rejects(browseGithubComparison("octocat/repo", head, "missing"), { status: 404 });
    const count = requests.length;
    await assert.rejects(browseGithubComparison("octocat/repo", head, "../secret"), {
      status: 400,
    });
    await assert.rejects(browseGithubCommit("octocat/repo", "invalid"), { status: 400 });
    await assert.rejects(browseGithubLog("octocat/repo", { sha: head, skip: "NaN" }), {
      status: 400,
    });
    assert.equal(requests.length, count);
  } finally {
    fetch.mock.restore();
    await rm(root, { recursive: true, force: true });
  }
});

test("GitHub path suggestions paginate owners, filter prefixes and respect authentication", async () => {
  const root = await mkdtemp(join(tmpdir(), "projector-gh-navigation-"));
  process.env.XDG_DATA_HOME = root;
  const { browseGithubDirectories, updateIntegration } =
    await import("../server/modules/integrations/index.ts");
  const requests = [];
  let token = "";
  let total = 102;
  const fetch = mock.method(globalThis, "fetch", async (address, init) => {
    const url = new URL(address);
    requests.push(url);
    assert.equal(url.origin, "https://api.github.com");
    assert.equal(init.headers.Authorization, token ? `Bearer ${token}` : undefined);
    if (!url.pathname.endsWith("/repos"))
      return Response.json({ type: url.pathname.endsWith("/team") ? "Organization" : "User" });
    const page = Number(url.searchParams.get("page"));
    return Response.json(
      Array.from({ length: Math.max(0, Math.min(100, total - (page - 1) * 100)) }, (_, i) => {
        const name = `repo-${(page - 1) * 100 + i}`;
        return { name, full_name: `${url.pathname.includes("team") ? "team" : "alice"}/${name}` };
      }),
    );
  });
  try {
    const siblings = await browseGithubDirectories("gh:/alice/current", false);
    assert.equal(siblings.entries.length, 102);
    assert.equal(siblings.truncated, false);
    assert.equal(requests.at(-1).pathname, "/users/alice/repos");
    assert.equal(requests.at(-1).searchParams.get("page"), "2");
    assert.equal((await browseGithubDirectories("gh:/alice/REPO-10", true)).entries.length, 3);
    assert.equal((await browseGithubDirectories("gh:/alice/", true)).entries.length, 102);
    assert.equal((await browseGithubDirectories("gh:/alice/absent", true)).entries.length, 0);
    await browseGithubDirectories("gh:/team", false);
    assert.equal(requests.at(-1).pathname, "/orgs/team/repos");
    const count = requests.length;
    for (const path of [
      "gh:/",
      "gh:/../evil",
      "gh:/alice/repo/extra",
      "gh:/alice/repo?x",
      "https://evil.test",
    ])
      await assert.rejects(browseGithubDirectories(path, false), { status: 400 });
    assert.equal(requests.length, count);
    await updateIntegration("github", (config) => ({
      ...config,
      enabled: true,
      credentials: { token: "secret", login: "Alice" },
    }));
    token = "secret";
    await browseGithubDirectories("gh:/alice", false);
    assert.equal(requests.at(-1).pathname, "/user/repos");
    assert.equal(requests.at(-1).searchParams.get("type"), "owner");
    await browseGithubDirectories("gh:/team", false);
    assert.equal(requests.at(-1).pathname, "/orgs/team/repos");
    await updateIntegration("github", (config) => ({ ...config, enabled: false }));
    token = "";
    total = 1000;
    assert.equal((await browseGithubDirectories("gh:/alice", false)).truncated, true);
  } finally {
    fetch.mock.restore();
    await rm(root, { recursive: true, force: true });
  }
});
