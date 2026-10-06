import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { githubProjectRoute } from "../core/modules/github/index.ts";
import { projectRoute } from "../src/modules/project/project-route.ts";
import { parseProjectRef, projectRefSegments } from "../core/modules/project/index.ts";

const projectPathSegments = (path) => projectRefSegments(parseProjectRef(path));

// XDG_DATA_HOME isolates JSON files, but the OS keyring is shared with the app.
process.env.PROJECTOR_SECRET_STORE = "file";

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
  const api = await import("../server/modules/github/index.ts");
  const { updateIntegration } = await import("../server/modules/integration-store/index.ts");
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
        owner: { login: "octocat", avatar_url: "https://avatars.example/octocat" },
        html_url: "https://github.com/octocat/repo",
        stargazers_count: 42,
        forks_count: 7,
        subscribers_count: 3,
        open_issues_count: 5,
        language: "TypeScript",
        license: { spdx_id: "MIT", name: "MIT License" },
        homepage: "https://example.test",
        topics: ["demo", "test"],
        created_at: "2020-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
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
    assert.equal(repo.owner, "octocat");
    assert.equal(repo.avatarUrl, "https://avatars.example/octocat");
    assert.equal(repo.htmlUrl, "https://github.com/octocat/repo");
    assert.equal(repo.defaultBranch, "main");
    assert.equal(repo.stars, 42);
    assert.equal(repo.forks, 7);
    assert.equal(repo.watchers, 3);
    assert.equal(repo.openIssues, 5);
    assert.equal(repo.language, "TypeScript");
    assert.equal(repo.license, "MIT");
    assert.equal(repo.homepage, "https://example.test");
    assert.deepEqual(repo.topics, ["demo", "test"]);
    assert.equal(repo.createdAt, "2020-01-01T00:00:00Z");
    assert.equal(repo.updatedAt, "2026-01-01T00:00:00Z");
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
    await updateIntegration("github", (config) => ({
      ...config,
      enabled: true,
      credentials: { token: "test-secret", login: "octocat" },
    }));
    authorized = true;
    const privateRepo = await api.browseGithubRepository("octocat/repo");
    assert.ok(!JSON.stringify(privateRepo).includes("test-secret"));
    await updateIntegration("github", (config) => ({ ...config, enabled: false }));
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
    await import("../server/modules/github/index.ts");
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
  const { browseGithubDirectories } = await import("../server/modules/github/index.ts");
  const { updateIntegration } = await import("../server/modules/integration-store/index.ts");
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

test("GitHub issues list filters pull requests, paginates and reads discussion comments", async () => {
  const root = await mkdtemp(join(tmpdir(), "projector-gh-issues-"));
  process.env.XDG_DATA_HOME = root;
  const { browseGithubIssues, browseGithubIssue } =
    await import("../server/modules/github/index.ts");
  const requests = [];
  let mode = "normal";
  const remoteIssue = (number, extra = {}) => ({
    number,
    title: `Issue ${number}`,
    state: "open",
    user: { login: "alice", avatar_url: "https://avatars.example/alice" },
    labels: [{ name: "bug", color: "ff0000" }],
    assignees: [{ login: "bob" }],
    comments: 2,
    body: "Body",
    html_url: `https://github.com/octocat/repo/issues/${number}`,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-02T00:00:00Z",
    ...extra,
  });
  const fetch = mock.method(globalThis, "fetch", async (address) => {
    const url = new URL(address);
    requests.push(url);
    assert.equal(url.origin, "https://api.github.com");
    if (mode === "error") return Response.json({}, { status: 403 });
    if (url.pathname === "/repos/octocat/repo/issues") {
      const page = Number(url.searchParams.get("page"));
      if (page === 2) return Response.json([remoteIssue(31)]);
      return Response.json([
        remoteIssue(1),
        remoteIssue(2, { pull_request: { url: "https://api.github.com/pulls/2" } }),
        ...Array.from({ length: 28 }, (_, index) => remoteIssue(index + 3)),
      ]);
    }
    if (url.pathname === "/repos/octocat/repo/issues/7") return Response.json(remoteIssue(7));
    if (url.pathname === "/repos/octocat/repo/issues/7/comments")
      return Response.json([
        { id: 11, user: { login: "carol" }, body: "First", html_url: "u", created_at: "d" },
        { id: 12, user: { login: "dave" }, body: "Second", html_url: "u", created_at: "d" },
      ]);
    throw new Error(`Unexpected URL: ${url}`);
  });
  try {
    const first = await browseGithubIssues("octocat/repo", { state: "open" });
    assert.equal(first.issues.length, 29);
    assert.equal(first.issues[0].number, 1);
    assert.equal(first.issues[0].author.login, "alice");
    assert.deepEqual(first.issues[0].labels, [{ name: "bug", color: "ff0000" }]);
    assert.equal(first.issues[0].state, "open");
    assert.equal(first.next, 2);
    assert.equal(requests.at(-1).searchParams.get("state"), "open");
    assert.equal(requests.at(-1).searchParams.get("per_page"), "30");

    const second = await browseGithubIssues("octocat/repo", { state: "open", page: "2" });
    assert.equal(second.issues.length, 1);
    assert.equal(second.issues[0].number, 31);
    assert.equal(second.next, null);

    await browseGithubIssues("octocat/repo", { state: "weird" });
    assert.equal(requests.at(-1).searchParams.get("state"), "open");

    const detail = await browseGithubIssue("octocat/repo", 7);
    assert.equal(detail.issue.number, 7);
    assert.equal(detail.issue.body, "Body");
    assert.equal(detail.issue.assignees[0].login, "bob");
    assert.equal(detail.comments.length, 2);
    assert.equal(detail.comments[0].author.login, "carol");
    assert.equal(detail.commentsTruncated, false);

    await assert.rejects(browseGithubIssue("octocat/repo", 0), { status: 400 });
    mode = "error";
    await assert.rejects(browseGithubIssues("octocat/repo", { state: "open" }), { status: 403 });
  } finally {
    fetch.mock.restore();
    await rm(root, { recursive: true, force: true });
  }
});

test("GitHub pull requests list derives state and detail gathers reviews, comments and files", async () => {
  const root = await mkdtemp(join(tmpdir(), "projector-gh-pulls-"));
  process.env.XDG_DATA_HOME = root;
  const { browseGithubPulls, browseGithubPull } = await import("../server/modules/github/index.ts");
  const requests = [];
  const remotePull = (number, extra = {}) => ({
    number,
    title: `Pull ${number}`,
    state: "open",
    draft: false,
    user: { login: "alice", avatar_url: "https://avatars.example/alice" },
    labels: [{ name: "bug", color: "ff0000" }],
    head: { ref: "feature", label: "fork:feature" },
    base: { ref: "main" },
    body: "Body",
    html_url: `https://github.com/octocat/repo/pull/${number}`,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-02T00:00:00Z",
    ...extra,
  });
  const fetch = mock.method(globalThis, "fetch", async (address) => {
    const url = new URL(address);
    requests.push(url);
    assert.equal(url.origin, "https://api.github.com");
    if (url.pathname === "/repos/octocat/repo/pulls")
      return Response.json([
        remotePull(1),
        remotePull(2, { state: "closed", merged_at: "2026-01-03T00:00:00Z" }),
        remotePull(3, { state: "closed" }),
        remotePull(4, { draft: true }),
      ]);
    if (url.pathname === "/repos/octocat/repo/pulls/7")
      return Response.json(
        remotePull(7, { commits: 3, additions: 10, deletions: 4, changed_files: 2 }),
      );
    if (url.pathname === "/repos/octocat/repo/pulls/7/reviews")
      return Response.json([
        { id: 1, user: { login: "bob" }, state: "APPROVED", body: "", html_url: "u" },
        { id: 2, user: { login: "bob" }, state: "COMMENTED", body: "", html_url: "u" },
        { id: 3, user: { login: "bob" }, state: "COMMENTED", body: "Note", html_url: "u" },
      ]);
    if (url.pathname === "/repos/octocat/repo/issues/7/comments")
      return Response.json([{ id: 11, user: { login: "carol" }, body: "Hi", html_url: "u" }]);
    if (url.pathname === "/repos/octocat/repo/pulls/7/files")
      return Response.json([
        { filename: "a.ts", status: "modified", additions: 6, deletions: 1 },
        {
          filename: "b.ts",
          previous_filename: "c.ts",
          status: "renamed",
          additions: 4,
          deletions: 3,
        },
      ]);
    throw new Error(`Unexpected URL: ${url}`);
  });
  try {
    const list = await browseGithubPulls("octocat/repo", { state: "all", page: "2" });
    assert.deepEqual(
      list.pulls.map((item) => item.state),
      ["open", "merged", "closed", "open"],
    );
    assert.equal(list.pulls[3].draft, true);
    assert.equal(list.pulls[0].head, "fork:feature");
    assert.equal(list.pulls[0].base, "main");
    assert.equal(list.next, null);
    assert.equal(requests.at(-1).searchParams.get("state"), "all");
    assert.equal(requests.at(-1).searchParams.get("page"), "2");

    const detail = await browseGithubPull("octocat/repo", 7);
    assert.equal(detail.pull.number, 7);
    assert.equal(detail.commits, 3);
    assert.equal(detail.additions, 10);
    assert.deepEqual(
      detail.reviews.map((item) => [item.id, item.state]),
      [
        [1, "approved"],
        [3, "commented"],
      ],
    );
    assert.equal(detail.comments[0].author.login, "carol");
    assert.equal(detail.files[1].previousPath, "c.ts");
    assert.equal(detail.filesTruncated, false);
    await assert.rejects(browseGithubPull("octocat/repo", 0), { status: 400 });
  } finally {
    fetch.mock.restore();
    await rm(root, { recursive: true, force: true });
  }
});

test("GitHub discussions need a token, page by cursor and nest replies under comments", async () => {
  const root = await mkdtemp(join(tmpdir(), "projector-gh-discussions-"));
  process.env.XDG_DATA_HOME = root;
  const { browseGithubDiscussions, browseGithubDiscussion } =
    await import("../server/modules/github/index.ts");
  const { updateIntegration } = await import("../server/modules/integration-store/index.ts");
  const requests = [];
  const remote = (number, extra = {}) => ({
    number,
    title: `Discussion ${number}`,
    closed: false,
    isAnswered: true,
    upvoteCount: 3,
    body: "Body",
    url: `https://github.com/octocat/repo/discussions/${number}`,
    author: null,
    category: { name: "Q&A", emoji: ":pray:" },
    labels: { nodes: [{ name: "bug", color: "ff0000" }, null] },
    comments: { totalCount: 2 },
    ...extra,
  });
  const fetch = mock.method(globalThis, "fetch", async (address, init) => {
    assert.equal(String(address), "https://api.github.com/graphql");
    assert.equal(init.headers.Authorization, "Bearer secret");
    const { query, variables } = JSON.parse(init.body);
    requests.push(variables);
    assert.equal(variables.owner, "octocat");
    assert.equal(variables.name, "repo");
    if (query.includes("discussion(number")) {
      if (variables.number === 404)
        return Response.json({ data: { repository: { discussion: null } } });
      const first = !variables.after;
      return Response.json({
        data: {
          repository: {
            discussion: {
              ...remote(7),
              comments: {
                pageInfo: { hasNextPage: first, endCursor: "next" },
                nodes: [
                  {
                    databaseId: first ? 1 : 2,
                    body: "Hi",
                    isAnswer: first,
                    author: { login: "carol" },
                    replies: {
                      totalCount: first ? 3 : 0,
                      nodes: first
                        ? [{ databaseId: 10, body: "Reply", author: { login: "dave" } }]
                        : [],
                    },
                  },
                ],
              },
            },
          },
        },
      });
    }
    return Response.json({
      data: {
        repository: {
          hasDiscussionsEnabled: variables.owner === "octocat",
          discussions: {
            nodes: [remote(1)],
            pageInfo: { hasNextPage: !variables.after, endCursor: "Y3Vyc29y" },
          },
        },
      },
    });
  });
  try {
    await assert.rejects(browseGithubDiscussions("octocat/repo", {}), { status: 401 });
    await updateIntegration("github", (config) => ({
      ...config,
      enabled: true,
      credentials: { token: "secret", login: "octocat" },
    }));
    const first = await browseGithubDiscussions("octocat/repo", { state: "closed", page: "1" });
    assert.deepEqual(requests.at(-1).states, ["CLOSED"]);
    assert.equal(requests.at(-1).after, null);
    assert.equal(first.discussions[0].author.login, "ghost");
    assert.equal(first.discussions[0].answered, true);
    assert.deepEqual(first.discussions[0].labels, [{ name: "bug", color: "ff0000" }]);
    assert.equal(first.next, "Y3Vyc29y");
    const second = await browseGithubDiscussions("octocat/repo", {
      state: "all",
      page: first.next,
    });
    assert.equal(requests.at(-1).after, "Y3Vyc29y");
    assert.equal(requests.at(-1).states, null);
    assert.equal(second.next, null);
    // A cursor that is not base64-like never reaches GraphQL.
    await browseGithubDiscussions("octocat/repo", { page: 'x"} injected' });
    assert.equal(requests.at(-1).after, null);

    const detail = await browseGithubDiscussion("octocat/repo", 7);
    assert.equal(detail.comments.length, 2);
    assert.equal(detail.comments[0].isAnswer, true);
    assert.equal(detail.comments[0].replies[0].author.login, "dave");
    assert.equal(detail.comments[0].repliesTruncated, true);
    assert.equal(detail.comments[1].repliesTruncated, false);
    await assert.rejects(browseGithubDiscussion("octocat/repo", 0), { status: 400 });
    await assert.rejects(browseGithubDiscussion("octocat/repo", 404), { status: 404 });
  } finally {
    fetch.mock.restore();
    await rm(root, { recursive: true, force: true });
  }
});
