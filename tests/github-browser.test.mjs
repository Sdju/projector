import { expect, test, vi } from "vite-plus/test";
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
  expect(projectRoute("gh:/octocat/Hello-World")).toBe("/gh/projects/octocat/Hello-World");
  expect(githubProjectRoute("https://github.com/octocat/Hello-World.git")).toBe(
    "/gh/projects/octocat/Hello-World",
  );
  expect(projectPathSegments("gh:/octocat/Hello-World")).toStrictEqual([
    { name: "gh:/", path: "gh:/" },
    { name: "octocat", path: "gh:/octocat" },
    { name: "Hello-World", path: "gh:/octocat/Hello-World" },
  ]);
  expect(projectPathSegments("/tmp/repo")).toStrictEqual([
    { name: "/", path: "/" },
    { name: "tmp", path: "/tmp" },
    { name: "repo", path: "/tmp/repo" },
  ]);
  for (const path of ["../repo", "owner/..", "owner/repo/extra", "https://evil.test/a/b"])
    expect(() => githubProjectRoute(path)).toThrow();
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
  const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (address, init) => {
    const url = new URL(address);
    requests.push(url.pathname);
    expect(url.origin).toBe("https://api.github.com");
    expect(init.headers.Authorization).toBe(authorized ? "Bearer test-secret" : undefined);
    expect(init.method).toBe(undefined);
    expect(init.redirect).toBe("error");
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
    expect(repo.commit).toBe(sha);
    expect(repo.tree).toBe(tree);
    expect(repo.empty).toBe(false);
    expect(repo.owner).toBe("octocat");
    expect(repo.avatarUrl).toBe("https://avatars.example/octocat");
    expect(repo.htmlUrl).toBe("https://github.com/octocat/repo");
    expect(repo.defaultBranch).toBe("main");
    expect(repo.stars).toBe(42);
    expect(repo.forks).toBe(7);
    expect(repo.watchers).toBe(3);
    expect(repo.openIssues).toBe(5);
    expect(repo.language).toBe("TypeScript");
    expect(repo.license).toBe("MIT");
    expect(repo.homepage).toBe("https://example.test");
    expect(repo.topics).toStrictEqual(["demo", "test"]);
    expect(repo.createdAt).toBe("2020-01-01T00:00:00Z");
    expect(repo.updatedAt).toBe("2026-01-01T00:00:00Z");
    await api.browseGithubRepository("octocat/repo", "feature/test");
    expect(requests.at(-1).endsWith("/feature%2Ftest")).toBeTruthy();
    const directory = await api.browseGithubTree("octocat/repo", tree);
    expect(directory.entries[0].name).toBe("src");
    expect(directory.entries.some((entry) => entry.name === "README.md")).toBeTruthy();
    const file = await api.browseGithubFile("octocat/repo", sha, "README.md");
    expect(file.content).toBe("# Hello");
    expect(file.binary).toBe(false);
    mode = "binary";
    expect((await api.browseGithubFile("octocat/repo", sha, "data.bin")).binary).toBe(true);
    const image = await api.browseGithubFile("octocat/repo", sha, "image.png");
    expect(image.image.startsWith("data:image/png;base64,")).toBeTruthy();
    mode = "large";
    await expect(api.browseGithubFile("octocat/repo", sha, "large.txt")).rejects.toMatchObject({
      status: 413,
    });
    mode = "empty";
    expect((await api.browseGithubRepository("octocat/repo")).empty).toBe(true);
    await expect(api.browseGithubRepository("octocat/repo", "missing")).rejects.toMatchObject({
      status: 409,
    });
    mode = "truncated";
    expect((await api.browseGithubTree("octocat/repo", tree)).truncated).toBe(true);
    mode = "missing";
    await expect(api.browseGithubRepository("octocat/repo")).rejects.toMatchObject({ status: 404 });
    mode = "limit";
    await expect(api.browseGithubRepository("octocat/repo")).rejects.toMatchObject({ status: 403 });
    const count = requests.length;
    await expect(api.browseGithubTree("octocat/repo", "../../evil")).rejects.toMatchObject({
      status: 400,
    });
    await expect(api.browseGithubRepository("owner/repo/../other")).rejects.toMatchObject({
      status: 400,
    });
    expect(requests.length).toBe(count);
    expect(await readdir(root)).toStrictEqual([]);
    mode = "normal";
    const asset = await api.browseGithubAsset("octocat/repo", tree, "src/image.png");
    expect(asset.mime).toBe("image/png");
    expect(asset.bytes.toString()).toBe("# Hello");
    await expect(api.browseGithubAsset("octocat/repo", tree, "missing.png")).rejects.toMatchObject({
      status: 404,
    });
    await expect(api.browseGithubAsset("octocat/repo", tree, "../image.png")).rejects.toMatchObject(
      {
        status: 400,
      },
    );
    await updateIntegration("github", (config) => ({
      ...config,
      enabled: true,
      credentials: { token: "test-secret", login: "octocat" },
    }));
    authorized = true;
    const privateRepo = await api.browseGithubRepository("octocat/repo");
    expect(!JSON.stringify(privateRepo).includes("test-secret")).toBeTruthy();
    await updateIntegration("github", (config) => ({ ...config, enabled: false }));
    authorized = false;
    await api.browseGithubRepository("octocat/repo");
  } finally {
    fetch.mockRestore();
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
  const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (address) => {
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
    expect(first.commits.length).toBe(50);
    expect(first.next).toBe(50);
    expect(first.commits[0].refs[0].kind).toBe("head");
    const second = await browseGithubLog("octocat/repo", { sha: head, skip: "50", limit: "50" });
    expect(second.commits[0].subject).toBe("Commit 50");
    expect(second.next).toBe(100);
    const last = await browseGithubLog("octocat/repo", { sha: head, skip: "100" });
    expect(last.commits.length).toBe(5);
    expect(last.next).toBe(null);
    expect(
      (await browseGithubLog("octocat/repo", { sha: head, q: "Commit 104" })).commits[0].subject,
    ).toBe("Commit 104");
    expect((await browseGithubLog("octocat/repo", { sha: head, q: "@alice" })).commits.length).toBe(
      50,
    );
    expect((await browseGithubLog("octocat/repo", { sha: "" })).commits.length).toBe(0);
    total = 605;
    const scan = await browseGithubLog("octocat/repo", { sha: head, q: "Commit 599" });
    expect(scan.commits.length).toBe(0);
    expect(scan.next).toBe(500);
    const continued = await browseGithubLog("octocat/repo", {
      sha: head,
      q: "Commit 599",
      skip: String(scan.next),
    });
    expect(continued.commits[0].subject).toBe("Commit 599");
    expect(continued.next).toBe(null);
    total = 105;
    const detail = await browseGithubCommit("octocat/repo", head);
    expect(detail.body).toBe("Details");
    expect(detail.files[0].status).toBe("R");
    expect(detail.files[0].originalPath).toBe("old.txt");
    expect(detail.committer).toBe("Bob");
    expect(await browseGithubComparison("octocat/repo", head, "new.txt")).toStrictEqual({
      path: "new.txt",
      original: "before",
      modified: "after",
      hash: head,
      parent: parent.slice(0, 7),
    });
    for (const next of ["add", "delete", "root"]) {
      mode = next;
      const comparison = await browseGithubComparison("octocat/repo", head, "new.txt");
      expect(comparison.original).toBe(next === "delete" ? "before" : "");
      expect(comparison.modified).toBe(next === "delete" ? "" : "after");
    }
    mode = "pages";
    expect((await browseGithubCommit("octocat/repo", head)).files.length).toBe(101);
    mode = "binary";
    await expect(browseGithubComparison("octocat/repo", head, "new.txt")).rejects.toMatchObject({
      status: 415,
    });
    await expect(browseGithubComparison("octocat/repo", head, "missing")).rejects.toMatchObject({
      status: 404,
    });
    await new Promise((resolve) => setTimeout(resolve, 100)); // let background fetches finish
    const count = requests.length;
    await expect(browseGithubComparison("octocat/repo", head, "../secret")).rejects.toMatchObject({
      status: 400,
    });
    await expect(browseGithubCommit("octocat/repo", "invalid")).rejects.toMatchObject({
      status: 400,
    });
    await expect(browseGithubLog("octocat/repo", { sha: head, skip: "NaN" })).rejects.toMatchObject(
      {
        status: 400,
      },
    );
    expect(requests.length).toBe(count);
  } finally {
    fetch.mockRestore();
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
  const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (address, init) => {
    const url = new URL(address);
    requests.push(url);
    expect(url.origin).toBe("https://api.github.com");
    expect(init.headers.Authorization).toBe(token ? `Bearer ${token}` : undefined);
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
    expect(siblings.entries.length).toBe(102);
    expect(siblings.truncated).toBe(false);
    expect(requests.at(-1).pathname).toBe("/users/alice/repos");
    expect(requests.at(-1).searchParams.get("page")).toBe("2");
    expect((await browseGithubDirectories("gh:/alice/REPO-10", true)).entries.length).toBe(3);
    expect((await browseGithubDirectories("gh:/alice/", true)).entries.length).toBe(102);
    expect((await browseGithubDirectories("gh:/alice/absent", true)).entries.length).toBe(0);
    await browseGithubDirectories("gh:/team", false);
    expect(requests.at(-1).pathname).toBe("/orgs/team/repos");
    const count = requests.length;
    for (const path of [
      "gh:/",
      "gh:/../evil",
      "gh:/alice/repo/extra",
      "gh:/alice/repo?x",
      "https://evil.test",
    ])
      await expect(browseGithubDirectories(path, false)).rejects.toMatchObject({ status: 400 });
    expect(requests.length).toBe(count);
    await updateIntegration("github", (config) => ({
      ...config,
      enabled: true,
      credentials: { token: "secret", login: "Alice" },
    }));
    token = "secret";
    await browseGithubDirectories("gh:/alice", false);
    expect(requests.at(-1).pathname).toBe("/user/repos");
    expect(requests.at(-1).searchParams.get("type")).toBe("owner");
    await browseGithubDirectories("gh:/team", false);
    expect(requests.at(-1).pathname).toBe("/orgs/team/repos");
    await updateIntegration("github", (config) => ({ ...config, enabled: false }));
    token = "";
    total = 1000;
    expect((await browseGithubDirectories("gh:/alice", false)).truncated).toBe(true);
  } finally {
    fetch.mockRestore();
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
    reactions: { heart: 4, rocket: 0 },
    html_url: `https://github.com/octocat/repo/issues/${number}`,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-02T00:00:00Z",
    ...extra,
  });
  const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (address) => {
    const url = new URL(address);
    requests.push(url);
    expect(url.origin).toBe("https://api.github.com");
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
        {
          id: 11,
          user: { login: "carol" },
          body: "First",
          reactions: { eyes: 1 },
          html_url: "u",
          created_at: "d",
        },
        { id: 12, user: { login: "dave" }, body: "Second", html_url: "u", created_at: "d" },
      ]);
    throw new Error(`Unexpected URL: ${url}`);
  });
  try {
    const first = await browseGithubIssues("octocat/repo", { state: "open" });
    expect(first.issues.length).toBe(29);
    expect(first.issues[0].number).toBe(1);
    expect(first.issues[0].author.login).toBe("alice");
    expect(first.issues[0].labels).toStrictEqual([{ name: "bug", color: "ff0000" }]);
    expect(first.issues[0].state).toBe("open");
    expect(first.issues[0].reactions).toStrictEqual([{ content: "heart", count: 4 }]);
    expect(first.next).toBe(2);
    expect(requests.at(-1).searchParams.get("state")).toBe("open");
    expect(requests.at(-1).searchParams.get("per_page")).toBe("30");

    const second = await browseGithubIssues("octocat/repo", { state: "open", page: "2" });
    expect(second.issues.length).toBe(1);
    expect(second.issues[0].number).toBe(31);
    expect(second.next).toBe(null);

    await browseGithubIssues("octocat/repo", { state: "weird" });
    expect(requests.at(-1).searchParams.get("state")).toBe("open");

    const detail = await browseGithubIssue("octocat/repo", 7);
    expect(detail.issue.number).toBe(7);
    expect(detail.issue.body).toBe("Body");
    expect(detail.issue.assignees[0].login).toBe("bob");
    expect(detail.comments.length).toBe(2);
    expect(detail.comments[0].author.login).toBe("carol");
    expect(detail.comments[0].reactions).toStrictEqual([{ content: "eyes", count: 1 }]);
    expect(detail.commentsTruncated).toBe(false);

    await expect(browseGithubIssue("octocat/repo", 0)).rejects.toMatchObject({ status: 400 });
    mode = "error";
    await expect(browseGithubIssues("octocat/repo", { state: "open" })).rejects.toMatchObject({
      status: 403,
    });
  } finally {
    fetch.mockRestore();
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
  const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (address) => {
    const url = new URL(address);
    requests.push(url);
    expect(url.origin).toBe("https://api.github.com");
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
    if (url.pathname === "/repos/octocat/repo/issues/7")
      return Response.json({ reactions: { "+1": 2, "-1": 0, hooray: 1, total_count: 3 } });
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
    expect(list.pulls.map((item) => item.state)).toStrictEqual([
      "open",
      "merged",
      "closed",
      "open",
    ]);
    expect(list.pulls[3].draft).toBe(true);
    expect(list.pulls[0].head).toBe("fork:feature");
    expect(list.pulls[0].base).toBe("main");
    expect(list.next).toBe(null);
    expect(requests.at(-1).searchParams.get("state")).toBe("all");
    expect(requests.at(-1).searchParams.get("page")).toBe("2");

    const detail = await browseGithubPull("octocat/repo", 7);
    expect(detail.pull.number).toBe(7);
    expect(detail.pull.reactions).toStrictEqual([
      { content: "+1", count: 2 },
      { content: "hooray", count: 1 },
    ]);
    expect(detail.commits).toBe(3);
    expect(detail.additions).toBe(10);
    expect(detail.reviews.map((item) => [item.id, item.state])).toStrictEqual([
      [1, "approved"],
      [3, "commented"],
    ]);
    expect(detail.comments[0].author.login).toBe("carol");
    expect(detail.files[1].previousPath).toBe("c.ts");
    expect(detail.filesTruncated).toBe(false);
    await expect(browseGithubPull("octocat/repo", 0)).rejects.toMatchObject({ status: 400 });
  } finally {
    fetch.mockRestore();
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
    reactionGroups: [
      { content: "THUMBS_UP", reactors: { totalCount: 5 } },
      { content: "HOORAY", reactors: { totalCount: 0 } },
    ],
    category: { name: "Q&A", emoji: ":pray:" },
    labels: { nodes: [{ name: "bug", color: "ff0000" }, null] },
    comments: { totalCount: 2 },
    ...extra,
  });
  const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (address, init) => {
    expect(String(address)).toBe("https://api.github.com/graphql");
    expect(init.headers.Authorization).toBe("Bearer secret");
    const { query, variables } = JSON.parse(init.body);
    requests.push(variables);
    expect(variables.owner).toBe("octocat");
    expect(variables.name).toBe("repo");
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
    await expect(browseGithubDiscussions("octocat/repo", {})).rejects.toMatchObject({
      status: 401,
    });
    await updateIntegration("github", (config) => ({
      ...config,
      enabled: true,
      credentials: { token: "secret", login: "octocat" },
    }));
    const first = await browseGithubDiscussions("octocat/repo", { state: "closed", page: "1" });
    expect(requests.at(-1).states).toStrictEqual(["CLOSED"]);
    expect(requests.at(-1).after).toBe(null);
    expect(first.discussions[0].author.login).toBe("ghost");
    expect(first.discussions[0].answered).toBe(true);
    expect(first.discussions[0].reactions).toStrictEqual([{ content: "+1", count: 5 }]);
    expect(first.discussions[0].labels).toStrictEqual([{ name: "bug", color: "ff0000" }]);
    expect(first.next).toBe("Y3Vyc29y");
    const second = await browseGithubDiscussions("octocat/repo", {
      state: "all",
      page: first.next,
    });
    expect(requests.at(-1).after).toBe("Y3Vyc29y");
    expect(requests.at(-1).states).toBe(null);
    expect(second.next).toBe(null);
    // A cursor that is not base64-like never reaches GraphQL.
    await browseGithubDiscussions("octocat/repo", { page: 'x"} injected' });
    expect(requests.at(-1).after).toBe(null);

    const detail = await browseGithubDiscussion("octocat/repo", 7);
    expect(detail.comments.length).toBe(2);
    expect(detail.comments[0].isAnswer).toBe(true);
    expect(detail.comments[0].replies[0].author.login).toBe("dave");
    expect(detail.comments[0].repliesTruncated).toBe(true);
    expect(detail.comments[1].repliesTruncated).toBe(false);
    await expect(browseGithubDiscussion("octocat/repo", 0)).rejects.toMatchObject({ status: 400 });
    await expect(browseGithubDiscussion("octocat/repo", 404)).rejects.toMatchObject({
      status: 404,
    });
  } finally {
    fetch.mockRestore();
    await rm(root, { recursive: true, force: true });
  }
});
