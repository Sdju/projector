import { expect, onTestFinished, test, vi } from "vite-plus/test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

process.env.PROJECTOR_SECRET_STORE = "file";

const secret = "glpat-browser-secret";

async function setup(url = "https://gitlab.com", token = "") {
  const root = await mkdtemp(join(tmpdir(), "projector-gitlab-browser-"));
  process.env.XDG_DATA_HOME = join(root, "data");
  const { updateIntegration } = await import("../server/modules/integration-store/index.ts");
  await updateIntegration("gitlab", () => ({
    enabled: true,
    settings: { url, directory: join(root, "projects") },
    credentials: token ? { token, login: "tester" } : {},
  }));
  onTestFinished(async () => {
    vi.restoreAllMocks();
    await rm(root, { recursive: true, force: true });
  });
}

function mockFetch(handler) {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
    expect(init.redirect, "GitLab redirects are forbidden").toBe("error");
    return handler(String(url), init);
  });
}

function apiPath(address, base = "https://gitlab.com") {
  return address.slice(`${base}/api/v4`.length);
}

function encoded(path) {
  return encodeURIComponent(path);
}

test("GitLab target allowlists gitlab.com and the configured instance without leaking the token", async () => {
  const { gitlabTarget } = await import("../server/modules/gitlab/index.ts");
  await setup("https://gitlab.com");
  expect(await gitlabTarget("gitlab.com/group/project")).toStrictEqual({
    instance: "gitlab.com",
    path: "group/project",
    base: "https://gitlab.com",
    token: "",
  });

  const { updateIntegration } = await import("../server/modules/integration-store/index.ts");
  await updateIntegration("gitlab", (config) => ({
    ...config,
    settings: { ...config.settings, url: "https://git.example.com/gitlab" },
    credentials: { token: secret, login: "tester" },
  }));
  expect(await gitlabTarget("git.example.com/team/sub/app")).toStrictEqual({
    instance: "git.example.com",
    path: "team/sub/app",
    base: "https://git.example.com/gitlab",
    token: secret,
  });
  expect(await gitlabTarget("https://git.example.com/gitlab/team/sub/app")).toStrictEqual({
    instance: "git.example.com",
    path: "team/sub/app",
    base: "https://git.example.com/gitlab",
    token: secret,
  });
  // The configured token belongs to the self-hosted instance, not to gitlab.com.
  expect(await gitlabTarget("gitlab.com/group/project")).toStrictEqual({
    instance: "gitlab.com",
    path: "group/project",
    base: "https://gitlab.com",
    token: "",
  });
  mockFetch((address, init) => {
    expect(init.headers["PRIVATE-TOKEN"]).toBe(undefined);
    const path = apiPath(address);
    if (path.endsWith("/languages")) return Response.json({});
    if (path.endsWith("/repository/commits/main")) return Response.json({ id: "a".repeat(40) });
    return Response.json({
      path_with_namespace: "group/project",
      default_branch: "main",
      visibility: "public",
    });
  });
  const { browseGitlabRepository } = await import("../server/modules/gitlab/index.ts");
  expect((await browseGitlabRepository("gitlab.com/group/project")).commit).toBe("a".repeat(40));
  for (const repository of ["evil.example.com/group/project", "gl:/evil.example.com/group/project"])
    await expect(gitlabTarget(repository)).rejects.toMatchObject({ status: 403 });
  await expect(gitlabTarget("group/project")).rejects.toMatchObject({ status: 400 });
  await expect(gitlabTarget("gitlab.com/group/../project")).rejects.toMatchObject({ status: 400 });
});

test("GitLab project card reads metadata, languages and the pinned commit", async () => {
  await setup();
  const calls = [];
  mockFetch((address, init) => {
    expect(init.headers["PRIVATE-TOKEN"]).toBe(undefined);
    const path = apiPath(address);
    calls.push(path);
    if (path.split("?")[0] === `/projects/${encoded("group/project")}`)
      return Response.json({
        path_with_namespace: "group/project",
        description: "Demo",
        default_branch: "main",
        visibility: "private",
        web_url: "https://gitlab.com/group/project",
        http_url_to_repo: "https://gitlab.com/group/project.git",
        archived: true,
        star_count: 4,
        forks_count: 2,
        open_issues_count: 3,
        open_merge_requests_count: 5,
        namespace: { name: "Group", avatar_url: "https://gitlab.com/avatar.png" },
        topics: ["demo", "tools"],
        license: { name: "MIT" },
        created_at: "2024-01-01T00:00:00Z",
        last_activity_at: "2024-02-01T00:00:00Z",
      });
    if (path === `/projects/${encoded("group/project")}/languages`)
      return Response.json({ TypeScript: 70, CSS: 30 });
    if (path === `/projects/${encoded("group/project")}/repository/commits/main`)
      return Response.json({ id: "a".repeat(40) });
    if (path.split("?")[0] === `/projects/${encoded("empty/repo")}`)
      return Response.json({ path_with_namespace: "empty/repo", empty_repo: true });
    if (path === `/projects/${encoded("empty/repo")}/languages`)
      return Response.json({}, { status: 404 });
    if (path.split("?")[0] === `/projects/${encoded("missing/commit")}`)
      return Response.json({ path_with_namespace: "missing/commit", default_branch: "main" });
    return Response.json({}, { status: 404 });
  });
  const { browseGitlabRepository } = await import("../server/modules/gitlab/index.ts");
  const project = await browseGitlabRepository("gitlab.com/group/project");
  expect(project).toMatchObject({
    fullName: "group/project",
    description: "Demo",
    defaultBranch: "main",
    branch: "main",
    commit: "a".repeat(40),
    private: true,
    empty: false,
    archived: true,
    visibility: "private",
    webUrl: "https://gitlab.com/group/project",
    httpUrlToRepo: "https://gitlab.com/group/project.git",
    owner: "Group",
    avatarUrl: "https://gitlab.com/avatar.png",
    stars: 4,
    forks: 2,
    openIssues: 3,
    openMergeRequests: 5,
    language: "TypeScript",
    license: "MIT",
    topics: ["demo", "tools"],
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-02-01T00:00:00Z",
  });
  expect(project.languages).toStrictEqual({ TypeScript: 70, CSS: 30 });

  const empty = await browseGitlabRepository("gitlab.com/empty/repo");
  expect(empty.empty).toBe(true);
  expect(empty.commit).toBe("");
  expect(
    calls.some((path) => path.includes(`/projects/${encoded("empty/repo")}/repository/`)),
  ).toBe(false);
  const missingCommit = await browseGitlabRepository("gitlab.com/missing/commit");
  expect(missingCommit.empty).toBe(true);
  expect(missingCommit.commit).toBe("");
});

test("GitLab project card falls back to statistics endpoints for counts", async () => {
  await setup();
  mockFetch((address) => {
    const url = new URL(address);
    const path = url.pathname;
    if (path.endsWith(`/projects/${encoded("group/stats")}`))
      return Response.json({ path_with_namespace: "group/stats", default_branch: "main" });
    if (path.endsWith("/languages")) return Response.json({});
    if (path.endsWith("/repository/commits/main")) return Response.json({ id: "a".repeat(40) });
    if (path.endsWith("/issues_statistics"))
      return Response.json({ statistics: { counts: { opened: 7 } } });
    if (path.endsWith("/merge_requests")) return Response.json([], { headers: { "X-Total": "9" } });
    return Response.json({}, { status: 404 });
  });
  const { browseGitlabRepository } = await import("../server/modules/gitlab/index.ts");
  const project = await browseGitlabRepository("gitlab.com/group/stats");
  expect(project.openIssues).toBe(7);
  expect(project.openMergeRequests).toBe(9);
});

test("GitLab tree follows pages, sorts folders first and reports truncation", async () => {
  await setup();
  let treePage = 0;
  mockFetch((address) => {
    const url = new URL(address);
    if (!url.pathname.endsWith("/repository/tree")) return Response.json({}, { status: 404 });
    expect(url.searchParams.get("ref")).toBe("abc1234");
    expect(url.searchParams.get("path")).toBe("src");
    treePage = Number(url.searchParams.get("page"));
    if (treePage === 1)
      return Response.json(
        [
          { name: "z.ts", path: "src/z.ts", type: "blob", mode: "100644", size: 10 },
          { name: "b", path: "src/b", type: "tree", mode: "040000" },
          { name: "a", path: "src/a", type: "tree", mode: "040000" },
        ],
        { headers: { "X-Next-Page": "2" } },
      );
    return Response.json([
      { name: "a.ts", path: "src/a.ts", type: "blob", mode: "100644", size: 5 },
    ]);
  });
  const { browseGitlabTree } = await import("../server/modules/gitlab/index.ts");
  const tree = await browseGitlabTree("gitlab.com/group/project", "abc1234", "src");
  expect(tree.truncated).toBe(false);
  expect(tree.entries.map((entry) => entry.path)).toStrictEqual([
    "src/a",
    "src/b",
    "src/a.ts",
    "src/z.ts",
  ]);
  expect(tree.entries[2]).toStrictEqual({
    name: "a.ts",
    path: "src/a.ts",
    type: "blob",
    mode: "100644",
    size: 5,
  });
  expect(treePage).toBe(2);

  treePage = 0;
  vi.restoreAllMocks();
  mockFetch((address) => {
    const url = new URL(address);
    const page = Number(url.searchParams.get("page"));
    treePage = page;
    return Response.json(
      Array.from({ length: 100 }, (_, index) => ({
        name: `file-${page}-${index}`,
        path: `file-${page}-${index}`,
        type: "blob",
        mode: "100644",
      })),
      { headers: { "X-Next-Page": String(page + 1) } },
    );
  });
  const truncated = await browseGitlabTree("gitlab.com/group/project", "abc1234");
  expect(truncated.entries.length).toBe(1000);
  expect(truncated.truncated).toBe(true);
  expect(treePage).toBe(10);
});

test("GitLab file decodes text, base64 and images and rejects large files", async () => {
  await setup();
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]);
  const svg = Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'></svg>");
  const files = {
    "dir/text.txt": { encoding: "text", content: "hello", size: 5 },
    "dir/script.sh": {
      encoding: "base64",
      content: Buffer.from("echo hi").toString("base64"),
      size: 7,
    },
    "dir/logo.svg": { encoding: "base64", content: svg.toString("base64"), size: svg.length },
    "dir/image.png": { encoding: "base64", content: png.toString("base64"), size: png.length },
    "dir/raw.dat": {
      encoding: "base64",
      content: Buffer.from([0, 1, 2]).toString("base64"),
      size: 3,
    },
  };
  mockFetch((address) => {
    const url = new URL(address);
    const filePath = decodeURIComponent(url.pathname.split("/repository/files/")[1] || "");
    if (filePath === "dir/large.txt")
      return Response.json({ encoding: "base64", content: "", size: 5 * 1024 * 1024 + 1 });
    const file = files[filePath];
    return file ? Response.json(file) : Response.json({}, { status: 404 });
  });
  const { browseGitlabFile } = await import("../server/modules/gitlab/index.ts");
  expect(
    await browseGitlabFile("gitlab.com/group/project", "abc1234", "dir/text.txt"),
  ).toStrictEqual({ content: "hello", image: null, binary: false, size: 5 });
  expect(
    await browseGitlabFile("gitlab.com/group/project", "abc1234", "dir/script.sh"),
  ).toStrictEqual({ content: "echo hi", image: null, binary: false, size: 7 });
  expect(
    await browseGitlabFile("gitlab.com/group/project", "abc1234", "dir/logo.svg"),
  ).toStrictEqual({
    content: svg.toString("utf8"),
    image: `data:image/svg+xml;base64,${svg.toString("base64")}`,
    binary: false,
    size: svg.length,
  });
  expect(
    await browseGitlabFile("gitlab.com/group/project", "abc1234", "dir/image.png"),
  ).toStrictEqual({
    content: "",
    image: `data:image/png;base64,${png.toString("base64")}`,
    binary: true,
    size: png.length,
  });
  expect(
    await browseGitlabFile("gitlab.com/group/project", "abc1234", "dir/raw.dat"),
  ).toStrictEqual({
    content: "",
    image: null,
    binary: true,
    size: 3,
  });
  await expect(
    browseGitlabFile("gitlab.com/group/project", "abc1234", "dir/large.txt"),
  ).rejects.toMatchObject({ status: 413 });
  for (const path of ["", "/abs", "a//b", "a/../b", "a\\b"])
    await expect(
      browseGitlabFile("gitlab.com/group/project", "abc1234", path),
    ).rejects.toMatchObject({ status: 400 });
});

test("GitLab asset returns bytes and a MIME type", async () => {
  await setup();
  const bytes = Buffer.from([1, 2, 3, 4]);
  mockFetch((address) => {
    const url = new URL(address);
    if (url.pathname.endsWith("/raw"))
      return new Response(bytes, { headers: { "Content-Type": "application/x-test" } });
    return Response.json({}, { status: 404 });
  });
  const { browseGitlabAsset } = await import("../server/modules/gitlab/index.ts");
  const image = await browseGitlabAsset("gitlab.com/group/project", "abc1234", "dir/logo.png");
  expect(image.mime).toBe("image/png");
  expect(image.bytes.equals(bytes)).toBe(true);
  const other = await browseGitlabAsset("gitlab.com/group/project", "abc1234", "dir/file.xyz");
  expect(other.mime).toBe("application/x-test");
  await expect(
    browseGitlabAsset("gitlab.com/group/project", "abc1234", "../secret"),
  ).rejects.toMatchObject({ status: 400 });
});

test("GitLab history maps commits, search, commit detail and comparison", async () => {
  await setup();
  const hash = "a".repeat(40);
  const parent = "b".repeat(40);
  const rows = [
    {
      id: hash,
      title: "Fix login",
      message: "Fix login\n\nLong body",
      author_name: "Tanuki",
      author_email: "tanuki@example.com",
      authored_date: "2024-01-01T10:00:00Z",
      committer_name: "Tanuki",
      committer_email: "tanuki@example.com",
      committed_date: "2024-01-01T11:00:00Z",
      parent_ids: [parent],
      stats: { additions: 12, deletions: 3 },
    },
  ];
  const diffs = [
    {
      old_path: "src/app.ts",
      new_path: "src/app.ts",
      diff: "@@ -1 +1 @@\n-old\n+new\n+more",
    },
    { old_path: "old.ts", new_path: "new.ts", renamed_file: true, diff: "@@ -1 +1 @@\n-a\n+b" },
    { old_path: "added.ts", new_path: "added.ts", new_file: true, diff: "@@ -0,0 +1 @@\n+added" },
    {
      old_path: "deleted.ts",
      new_path: "deleted.ts",
      deleted_file: true,
      diff: "@@ -1 +0,0 @@\n-removed",
    },
    { old_path: "image.png", new_path: "image.png" },
  ];
  mockFetch((address) => {
    const url = new URL(address);
    const path = url.pathname;
    if (path.endsWith("/repository/commits"))
      return Response.json(rows, {
        headers: { "X-Next-Page": url.searchParams.get("page") === "1" ? "2" : "" },
      });
    if (path.endsWith("/search")) {
      expect(url.searchParams.get("scope")).toBe("commits");
      expect(url.searchParams.get("search")).toBe("login");
      return Response.json(rows);
    }
    if (path.endsWith(`/repository/commits/${hash}`)) return Response.json(rows[0]);
    if (path.endsWith(`/repository/commits/${hash}/diff`)) return Response.json(diffs);
    if (path.includes("/repository/files/")) {
      const ref = url.searchParams.get("ref");
      const content = ref === parent ? "old" : "new";
      return Response.json({ encoding: "text", content, size: content.length });
    }
    return Response.json({}, { status: 404 });
  });
  const { browseGitlabLog, browseGitlabCommit, browseGitlabComparison } =
    await import("../server/modules/gitlab/index.ts");
  const log = await browseGitlabLog("gitlab.com/group/project", { sha: hash, page: "1" });
  expect(log.head).toBe(hash);
  expect(log.next).toBe(2);
  expect(log.commits[0]).toStrictEqual({
    hash,
    parents: [parent],
    subject: "Fix login",
    author: "Tanuki",
    email: "tanuki@example.com",
    date: "2024-01-01T10:00:00Z",
    refs: [],
    unpushed: false,
  });
  const next = await browseGitlabLog("gitlab.com/group/project", { sha: hash, page: "2" });
  expect(next.next).toBe(null);
  const search = await browseGitlabLog("gitlab.com/group/project", { query: "login", page: "1" });
  expect(search.commits).toHaveLength(1);

  const detail = await browseGitlabCommit("gitlab.com/group/project", hash);
  expect(detail).toMatchObject({
    hash,
    parents: [parent],
    subject: "Fix login",
    body: "Long body",
    committer: "Tanuki",
    committerDate: "2024-01-01T11:00:00Z",
    additions: 12,
    deletions: 3,
  });
  expect(detail.files).toStrictEqual([
    {
      path: "added.ts",
      originalPath: undefined,
      status: "A",
      additions: 1,
      deletions: 0,
      binary: false,
    },
    {
      path: "deleted.ts",
      originalPath: undefined,
      status: "D",
      additions: 0,
      deletions: 1,
      binary: false,
    },
    {
      path: "image.png",
      originalPath: undefined,
      status: "M",
      additions: 0,
      deletions: 0,
      binary: true,
    },
    {
      path: "new.ts",
      originalPath: "old.ts",
      status: "R",
      additions: 1,
      deletions: 1,
      binary: false,
    },
    {
      path: "src/app.ts",
      originalPath: undefined,
      status: "M",
      additions: 2,
      deletions: 1,
      binary: false,
    },
  ]);

  const comparison = await browseGitlabComparison("gitlab.com/group/project", hash, "src/app.ts");
  expect(comparison).toStrictEqual({
    path: "src/app.ts",
    original: "old",
    modified: "new",
    hash,
    parent: parent.slice(0, 7),
  });
  await expect(
    browseGitlabComparison("gitlab.com/group/project", hash, "missing.ts"),
  ).rejects.toMatchObject({ status: 404 });
  await expect(
    browseGitlabComparison("gitlab.com/group/project", hash, "image.png"),
  ).rejects.toMatchObject({ status: 415 });
});

test("GitLab search errors stay explicit and API failures keep their status", async () => {
  await setup();
  let mode = "search";
  mockFetch((address) => {
    const url = new URL(address);
    if (mode === "search" && url.pathname.endsWith("/search"))
      return Response.json({ message: "404 Project Not Found" }, { status: 404 });
    if (mode === "status") {
      const status = Number(decodeURIComponent(url.pathname).split("/").at(-1));
      return Response.json({}, { status });
    }
    return Response.json({}, { status: 404 });
  });
  const { browseGitlabLog, browseGitlabRepository } =
    await import("../server/modules/gitlab/index.ts");
  await expect(
    browseGitlabLog("gitlab.com/group/project", { query: "login" }),
  ).rejects.toMatchObject({ status: 400, message: /Поиск коммитов GitLab недоступен/ });

  mode = "status";
  await expect(browseGitlabRepository("gitlab.com/status/401")).rejects.toMatchObject({
    status: 401,
    message: /Авторизация GitLab истекла или недействительна/,
  });
  await expect(browseGitlabRepository("gitlab.com/status/404")).rejects.toMatchObject({
    status: 404,
    message: /Проект не найден или нет доступа/,
  });
  await expect(browseGitlabRepository("gitlab.com/status/429")).rejects.toMatchObject({
    status: 429,
    message: /Превышен лимит GitLab/,
  });
});

test("GitLab blob search reads a pinned commit and maps snippets", async () => {
  await setup();
  const hash = "a".repeat(40);
  mockFetch((address) => {
    const url = new URL(address);
    if (url.pathname.endsWith("/search")) {
      expect(url.searchParams.get("scope")).toBe("blobs");
      expect(url.searchParams.get("search")).toBe("hello");
      expect(url.searchParams.get("ref")).toBe(hash);
      expect(url.searchParams.get("per_page")).toBe("100");
      return Response.json(
        [
          { path: "src/app.ts", data: "before\nconst hello = 1;\nafter", startline: 10 },
          { path: "src/other.ts", data: "hello again", startline: 3 },
        ],
        { headers: { "X-Next-Page": "" } },
      );
    }
    return Response.json({}, { status: 404 });
  });
  const { searchGitlabBlobs } = await import("../server/modules/gitlab/index.ts");
  expect(
    await searchGitlabBlobs("gitlab.com/group/project", { q: "hello", rev: hash }),
  ).toStrictEqual({
    hits: [
      {
        path: "src/app.ts",
        line: 11,
        column: 7,
        text: "const hello = 1;",
        matches: [{ start: 6, end: 11 }],
      },
      {
        path: "src/other.ts",
        line: 3,
        column: 1,
        text: "hello again",
        matches: [{ start: 0, end: 5 }],
      },
    ],
    truncated: false,
  });
  await expect(
    searchGitlabBlobs("gitlab.com/group/project", { q: "[", regex: "true", rev: hash }),
  ).rejects.toMatchObject({ status: 400, message: /регулярное выражение/ });
});

test("GitLab blob search explains when Advanced Search is unavailable", async () => {
  await setup();
  mockFetch(() => Response.json({ message: "400 Bad request" }, { status: 400 }));
  const { searchGitlabBlobs } = await import("../server/modules/gitlab/index.ts");
  await expect(
    searchGitlabBlobs("gitlab.com/group/project", { q: "hello", rev: "a".repeat(40) }),
  ).rejects.toMatchObject({
    status: 400,
    message: /Advanced Search/,
  });
});

test("GitLab comparison reads changed paths and both file sides", async () => {
  await setup();
  mockFetch((address) => {
    const path = apiPath(address);
    const url = new URL(address);
    if (path.includes("/repository/compare"))
      return Response.json({
        diffs: [
          { old_path: "a.txt", new_path: "a.txt", diff: "@@ -1 +1,2 @@\n-a\n+b\n+c\n" },
          { old_path: "old.txt", new_path: "new.txt", renamed_file: true, diff: "" },
          { old_path: "gone.txt", new_path: "gone.txt", deleted_file: true, diff: "" },
        ],
      });
    if (path.includes("/repository/files/")) {
      if (
        path.includes(encodeURIComponent("gone.txt")) &&
        (url.searchParams.get("ref") || "").startsWith("b")
      )
        return Response.json({ message: "404 File Not Found" }, { status: 404 });
      const content = (url.searchParams.get("ref") || "").startsWith("a") ? "old\n" : "new\n";
      return Response.json({
        encoding: "base64",
        size: Buffer.byteLength(content),
        content: Buffer.from(content).toString("base64"),
      });
    }
    return Response.json({});
  });
  const { browseGitlabCompareChanges, browseGitlabCompareFile } =
    await import("../server/modules/gitlab/index.ts");
  const repository = "gitlab.com/group/project";
  const from = "a".repeat(40);
  const to = "b".repeat(40);
  const changes = await browseGitlabCompareChanges(repository, from, to);
  expect(changes.truncated).toBe(false);
  expect(changes.changes.map((change) => [change.path, change.kind])).toStrictEqual([
    ["a.txt", "modified"],
    ["new.txt", "renamed"],
    ["gone.txt", "deleted"],
  ]);
  expect(changes.changes[0]).toMatchObject({ additions: 2, deletions: 1 });
  expect(await browseGitlabCompareFile(repository, from, to, "a.txt")).toStrictEqual({
    path: "a.txt",
    original: "old\n",
    modified: "new\n",
  });
  expect(await browseGitlabCompareFile(repository, from, to, "gone.txt")).toStrictEqual({
    path: "gone.txt",
    original: "old\n",
    modified: "",
  });
  expect(await browseGitlabCompareFile(repository, from, to, "new.txt", "old.txt")).toStrictEqual({
    path: "new.txt",
    original: "old\n",
    modified: "new\n",
  });
});
