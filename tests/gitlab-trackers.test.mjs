import { expect, onTestFinished, test, vi } from "vite-plus/test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

process.env.PROJECTOR_SECRET_STORE = "file";

const repository = "gitlab.com/group/project";
const id = encodeURIComponent("group/project");

async function setup(url = "https://gitlab.com", token = "") {
  const root = await mkdtemp(join(tmpdir(), "projector-gitlab-trackers-"));
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

function issueRow(overrides = {}) {
  return {
    iid: 12,
    title: "Crash on login",
    state: "opened",
    author: { username: "tanuki", avatar_url: "https://gitlab.com/a.png" },
    assignees: [{ username: "rev", avatar_url: "" }],
    labels: ["bug", { name: "backend", color: "#ff0000" }],
    user_notes_count: 7,
    description: "Steps to reproduce",
    web_url: "https://gitlab.com/group/project/-/issues/12",
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-02T00:00:00Z",
    ...overrides,
  };
}

function mergeRequestRow(overrides = {}) {
  return {
    iid: 7,
    title: "Add search",
    state: "opened",
    draft: false,
    merged_at: null,
    author: { username: "tanuki", avatar_url: "https://gitlab.com/a.png" },
    labels: [{ name: "feature", color: "#00ff00" }],
    description: "Search body",
    web_url: "https://gitlab.com/group/project/-/merge_requests/7",
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-02T00:00:00Z",
    source_branch: "feat/search",
    target_branch: "main",
    changes_count: "2",
    commits_count: 3,
    ...overrides,
  };
}

test("GitLab issues list maps fields, states and pages", async () => {
  await setup();
  const queries = [];
  const rows = [
    issueRow(),
    ...Array.from({ length: 29 }, (_, index) => issueRow({ iid: index + 2, labels: [] })),
  ];
  mockFetch((address) => {
    const url = new URL(address);
    expect(url.pathname).toBe(`/api/v4/projects/${id}/issues`);
    queries.push(Object.fromEntries(url.searchParams));
    if (url.searchParams.get("page") === "1" && url.searchParams.get("state") === "opened")
      return Response.json(rows, { headers: { "X-Next-Page": "2" } });
    return Response.json([]);
  });
  const { browseGitlabIssues } = await import("../server/modules/gitlab/index.ts");
  const list = await browseGitlabIssues(repository);
  expect(queries[0]).toStrictEqual({
    state: "opened",
    per_page: "30",
    page: "1",
    order_by: "updated_at",
    sort: "desc",
    with_labels_details: "true",
  });
  expect(list.issues).toHaveLength(30);
  expect(list.next).toBe(2);
  expect(list.issues[0]).toStrictEqual({
    number: 12,
    title: "Crash on login",
    state: "open",
    author: { login: "tanuki", avatarUrl: "https://gitlab.com/a.png" },
    labels: [
      { name: "bug", color: "" },
      { name: "backend", color: "ff0000" },
    ],
    assignees: [{ login: "rev", avatarUrl: "" }],
    comments: 7,
    body: "Steps to reproduce",
    reactions: [],
    htmlUrl: "https://gitlab.com/group/project/-/issues/12",
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-02T00:00:00Z",
  });

  expect((await browseGitlabIssues(repository, { state: "closed", page: "2" })).next).toBe(null);
  await browseGitlabIssues(repository, { state: "all" });
  await browseGitlabIssues(repository, { state: "nonsense" });
  expect(queries.map((query) => [query.state, query.page])).toStrictEqual([
    ["opened", "1"],
    ["closed", "2"],
    ["all", "1"],
    ["opened", "1"],
  ]);

  // Without the pagination header a full page still means there is more.
  vi.restoreAllMocks();
  mockFetch(() =>
    Response.json(Array.from({ length: 30 }, (_, index) => issueRow({ iid: index + 1 }))),
  );
  expect((await browseGitlabIssues(repository)).next).toBe(2);
});

test("GitLab issue detail hides system notes and maps award emoji", async () => {
  await setup();
  const notesQueries = [];
  mockFetch((address) => {
    const url = new URL(address);
    const path = url.pathname;
    if (path === `/api/v4/projects/${id}/issues/12`) return Response.json(issueRow());
    if (path === `/api/v4/projects/${id}/issues/12/award_emoji`)
      return Response.json([
        { name: "thumbsup", user: { username: "a" } },
        { name: "thumbsup", user: { username: "b" } },
        { name: "laughing", user: { username: "c" } },
        { name: "confused", user: { username: "d" } },
        { name: "unknown", user: { username: "e" } },
      ]);
    if (path === `/api/v4/projects/${id}/issues/12/notes`) {
      notesQueries.push(Object.fromEntries(url.searchParams));
      return Response.json([
        {
          id: 1,
          system: true,
          body: "changed the description",
          author: { username: "tanuki" },
          created_at: "2024-01-02T00:00:00Z",
        },
        {
          id: 2,
          system: false,
          body: "Same here",
          author: { username: "rev", avatar_url: "" },
          created_at: "2024-01-03T00:00:00Z",
        },
      ]);
    }
    return Response.json({}, { status: 404 });
  });
  const { browseGitlabIssue } = await import("../server/modules/gitlab/index.ts");
  const detail = await browseGitlabIssue(repository, 12);
  expect(notesQueries[0]).toStrictEqual({
    sort: "asc",
    order_by: "created_at",
    per_page: "100",
    page: "1",
  });
  expect(detail.issue.comments).toBe(7);
  expect(detail.issue.reactions).toStrictEqual([
    { content: "+1", count: 2 },
    { content: "laugh", count: 1 },
    { content: "confused", count: 1 },
  ]);
  expect(detail.comments).toStrictEqual([
    {
      id: 2,
      author: { login: "rev", avatarUrl: "" },
      body: "Same here",
      reactions: [],
      htmlUrl: "",
      createdAt: "2024-01-03T00:00:00Z",
    },
  ]);
  expect(detail.commentsTruncated).toBe(false);

  // Award emoji are cosmetic: a restricted instance must not break the issue.
  vi.restoreAllMocks();
  mockFetch((address) => {
    const path = new URL(address).pathname;
    if (path.endsWith("/award_emoji")) return Response.json({}, { status: 403 });
    if (path.endsWith("/notes")) return Response.json([]);
    if (path.endsWith("/issues/12")) return Response.json(issueRow());
    return Response.json({}, { status: 404 });
  });
  expect((await browseGitlabIssue(repository, 12)).issue.reactions).toStrictEqual([]);
});

test("GitLab issue notes stop after five pages and report truncation", async () => {
  await setup();
  const pages = [];
  mockFetch((address) => {
    const url = new URL(address);
    const path = url.pathname;
    if (path === `/api/v4/projects/${id}/issues/3`) return Response.json(issueRow({ iid: 3 }));
    if (path.endsWith("/award_emoji")) return Response.json([]);
    if (path.endsWith("/notes")) {
      const page = Number(url.searchParams.get("page"));
      pages.push(page);
      return Response.json(
        Array.from({ length: 100 }, (_, index) => ({
          id: page * 1000 + index,
          system: index === 0,
          body: `note ${page}-${index}`,
          author: { username: "tanuki" },
          created_at: "2024-01-03T00:00:00Z",
        })),
      );
    }
    return Response.json({}, { status: 404 });
  });
  const { browseGitlabIssue } = await import("../server/modules/gitlab/index.ts");
  const detail = await browseGitlabIssue(repository, 3);
  expect(pages).toStrictEqual([1, 2, 3, 4, 5]);
  expect(detail.comments).toHaveLength(495);
  expect(detail.commentsTruncated).toBe(true);
});

test("GitLab merge requests list maps states, drafts, branches and pages", async () => {
  await setup();
  const queries = [];
  const rows = [
    mergeRequestRow(),
    mergeRequestRow({ iid: 8, title: "Draft: search", draft: true }),
    mergeRequestRow({ iid: 9, title: "Old WIP", work_in_progress: true }),
    mergeRequestRow({ iid: 10, title: "Merged search", state: "merged", merged_at: "2024-01-04Z" }),
    mergeRequestRow({ iid: 11, title: "Dropped search", state: "closed" }),
    ...Array.from({ length: 25 }, (_, index) => mergeRequestRow({ iid: index + 20, labels: [] })),
  ];
  mockFetch((address) => {
    const url = new URL(address);
    expect(url.pathname).toBe(`/api/v4/projects/${id}/merge_requests`);
    queries.push(Object.fromEntries(url.searchParams));
    if (url.searchParams.get("state") === "opened" && url.searchParams.get("page") === "1")
      return Response.json(rows);
    return Response.json([mergeRequestRow({ iid: 30, state: "merged", merged_at: "2024-01-04Z" })]);
  });
  const { browseGitlabMergeRequests } = await import("../server/modules/gitlab/index.ts");
  const list = await browseGitlabMergeRequests(repository);
  expect(queries[0]).toStrictEqual({
    state: "opened",
    per_page: "30",
    page: "1",
    order_by: "updated_at",
    sort: "desc",
    with_labels_details: "true",
  });
  // A full page without the header still points at the next page.
  expect(list.next).toBe(2);
  expect(list.pulls[0]).toStrictEqual({
    number: 7,
    title: "Add search",
    state: "open",
    draft: false,
    author: { login: "tanuki", avatarUrl: "https://gitlab.com/a.png" },
    labels: [{ name: "feature", color: "00ff00" }],
    head: "feat/search",
    base: "main",
    body: "Search body",
    reactions: [],
    htmlUrl: "https://gitlab.com/group/project/-/merge_requests/7",
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-02T00:00:00Z",
  });
  expect(list.pulls.slice(0, 5).map((pull) => [pull.state, pull.draft])).toStrictEqual([
    ["open", false],
    ["open", true],
    ["open", true],
    ["merged", false],
    ["closed", false],
  ]);

  const merged = await browseGitlabMergeRequests(repository, { state: "merged" });
  expect(queries[1].state).toBe("merged");
  expect(merged.pulls[0].state).toBe("merged");
  expect(merged.next).toBe(null);
  await browseGitlabMergeRequests(repository, { state: "open" });
  await browseGitlabMergeRequests(repository, { state: "all" });
  await browseGitlabMergeRequests(repository, { state: "bogus" });
  expect(queries.slice(2).map((query) => query.state)).toStrictEqual(["opened", "all", "opened"]);
});

test("GitLab merge request list exposes CI, comments and merge readiness", async () => {
  await setup();
  mockFetch(() =>
    Response.json([
      mergeRequestRow({
        iid: 12,
        head_pipeline: { id: 5, status: "failed", ref: "feat/search", sha: "c".repeat(40) },
        user_notes_count: 4,
        detailed_merge_status: "discussions_not_resolved",
        has_conflicts: true,
        blocking_discussions_resolved: false,
      }),
    ]),
  );
  const { browseGitlabMergeRequests } = await import("../server/modules/gitlab/index.ts");
  const list = await browseGitlabMergeRequests(repository);
  expect(list.pulls[0]).toMatchObject({
    number: 12,
    comments: 4,
    mergeStatus: "discussions_not_resolved",
    hasConflicts: true,
    blockingDiscussionsResolved: false,
    pipeline: { id: 5, status: "failed", ref: "feat/search" },
  });
});

test("GitLab merge request detail maps notes, approvals, files and diff counts", async () => {
  await setup();
  const diffQueries = [];
  mockFetch((address) => {
    const url = new URL(address);
    const path = url.pathname;
    if (path === `/api/v4/projects/${id}/merge_requests/7`)
      return Response.json(mergeRequestRow({ changes_count: "5", commits_count: 4 }));
    if (path === `/api/v4/projects/${id}/merge_requests/7/award_emoji`)
      return Response.json([{ name: "rocket" }, { name: "thumbsup" }]);
    if (path === `/api/v4/projects/${id}/merge_requests/7/approvals`)
      return Response.json({ approved_by: [{ user: { id: 5, username: "rev", avatar_url: "" } }] });
    if (path === `/api/v4/projects/${id}/merge_requests/7/notes`)
      return Response.json([
        {
          id: 1,
          system: true,
          body: "added 2 commits",
          author: { username: "tanuki" },
          created_at: "2024-01-02T00:00:00Z",
        },
        {
          id: 2,
          system: false,
          body: "Looks good",
          author: { username: "rev", avatar_url: "" },
          created_at: "2024-01-03T00:00:00Z",
        },
      ]);
    if (path === `/api/v4/projects/${id}/merge_requests/7/diffs`) {
      diffQueries.push(Object.fromEntries(url.searchParams));
      return Response.json([
        { old_path: "src/app.ts", new_path: "src/app.ts", diff: "@@\n-a\n+b\n+c" },
        { old_path: "old.ts", new_path: "new.ts", renamed_file: true, diff: "@@\n-x\n+y" },
        { old_path: "new.ts", new_path: "new.ts", new_file: true, diff: "@@\n+only" },
        { old_path: "gone.ts", new_path: "gone.ts", deleted_file: true, diff: "@@\n-gone" },
        { old_path: "copy.ts", new_path: "copy2.ts", copied_file: true, diff: "" },
      ]);
    }
    return Response.json({}, { status: 404 });
  });
  const { browseGitlabMergeRequest } = await import("../server/modules/gitlab/index.ts");
  const detail = await browseGitlabMergeRequest(repository, 7);
  expect(diffQueries).toStrictEqual([{ per_page: "100", page: "1" }]);
  expect(detail.pull.number).toBe(7);
  expect(detail.pull.reactions).toStrictEqual([
    { content: "+1", count: 1 },
    { content: "rocket", count: 1 },
  ]);
  expect(detail.comments).toStrictEqual([
    {
      id: 2,
      author: { login: "rev", avatarUrl: "" },
      body: "Looks good",
      reactions: [],
      htmlUrl: "",
      createdAt: "2024-01-03T00:00:00Z",
    },
  ]);
  expect(detail.reviews).toStrictEqual([
    {
      id: 5,
      author: { login: "rev", avatarUrl: "" },
      state: "approved",
      body: "",
      htmlUrl: "",
      submittedAt: "",
    },
  ]);
  expect(detail.files).toStrictEqual([
    {
      path: "src/app.ts",
      previousPath: "",
      status: "modified",
      additions: 2,
      deletions: 1,
    },
    { path: "new.ts", previousPath: "old.ts", status: "renamed", additions: 1, deletions: 1 },
    { path: "new.ts", previousPath: "", status: "added", additions: 1, deletions: 0 },
    { path: "gone.ts", previousPath: "", status: "removed", additions: 0, deletions: 1 },
    { path: "copy2.ts", previousPath: "copy.ts", status: "copied", additions: 0, deletions: 0 },
  ]);
  expect(detail).toMatchObject({
    commits: 4,
    additions: 4,
    deletions: 3,
    changedFiles: 5,
    commentsTruncated: false,
    filesTruncated: false,
  });
});

test("GitLab merge request falls back to /changes and tolerates missing approvals", async () => {
  await setup();
  mockFetch((address) => {
    const url = new URL(address);
    const path = url.pathname;
    if (path.endsWith("/merge_requests/8"))
      return Response.json(
        mergeRequestRow({ iid: 8, changes_count: undefined, commits_count: undefined }),
      );
    if (path.endsWith("/merge_requests/8/award_emoji")) return Response.json([]);
    if (path.endsWith("/merge_requests/8/approvals"))
      return Response.json({ message: "403 Forbidden" }, { status: 403 });
    if (path.endsWith("/merge_requests/8/notes")) return Response.json([]);
    if (path.endsWith("/merge_requests/8/commits"))
      return Response.json([], { headers: { "X-Total": "6" } });
    if (path.endsWith("/merge_requests/8/diffs"))
      return Response.json({ message: "404 Not Found" }, { status: 404 });
    if (path.endsWith("/merge_requests/8/changes"))
      return Response.json({
        changes: Array.from({ length: 301 }, (_, index) => ({
          old_path: `file-${index}.ts`,
          new_path: `file-${index}.ts`,
          diff: "@@\n-old\n+new",
        })),
      });
    if (path.endsWith("/merge_requests/9"))
      return Response.json(mergeRequestRow({ iid: 9, changes_count: undefined }));
    if (path.endsWith("/merge_requests/9/award_emoji")) return Response.json({}, { status: 404 });
    if (path.endsWith("/merge_requests/9/approvals")) return Response.json({}, { status: 404 });
    if (path.endsWith("/merge_requests/9/notes")) return Response.json([]);
    if (path.endsWith("/merge_requests/9/diffs"))
      return Response.json({ message: "404 Not Found" }, { status: 404 });
    if (path.endsWith("/merge_requests/9/changes")) return Response.json({ changes: [] });
    return Response.json({}, { status: 404 });
  });
  const { browseGitlabMergeRequest } = await import("../server/modules/gitlab/index.ts");
  const detail = await browseGitlabMergeRequest(repository, 8);
  expect(detail.files).toHaveLength(300);
  expect(detail.filesTruncated).toBe(true);
  expect(detail.reviews).toStrictEqual([]);
  expect(detail.changedFiles).toBe(300);
  expect(detail.commits).toBe(6);
  expect(detail.additions).toBe(300);
  expect(detail.deletions).toBe(300);

  const empty = await browseGitlabMergeRequest(repository, 9);
  expect(empty.files).toStrictEqual([]);
  expect(empty.reviews).toStrictEqual([]);
  expect(empty.filesTruncated).toBe(false);
});

test("GitLab merge request exposes its latest pipeline, reviewers and approval quota", async () => {
  await setup();
  mockFetch((address) => {
    const url = new URL(address);
    const path = url.pathname;
    if (path === `/api/v4/projects/${id}/merge_requests/11`)
      return Response.json(
        mergeRequestRow({
          iid: 11,
          reviewers: [
            { username: "rev", avatar_url: "" },
            { username: "duo", avatar_url: "" },
          ],
          head_pipeline: {
            id: 99,
            status: "running",
            source: "merge_request_event",
            ref: "refs/merge-requests/11/merge",
            sha: "b".repeat(40),
            web_url: "https://gitlab.com/group/project/-/pipelines/99",
            created_at: "2024-01-01T00:00:00Z",
            updated_at: "2024-01-01T00:01:00Z",
            duration: null,
            user: { username: "tanuki", avatar_url: "" },
          },
        }),
      );
    if (path === `/api/v4/projects/${id}/merge_requests/11/award_emoji`) return Response.json([]);
    if (path === `/api/v4/projects/${id}/merge_requests/11/approvals`)
      return Response.json({
        approved_by: [{ user: { id: 5, username: "rev" } }],
        approvals_required: 2,
        approvals_left: 1,
      });
    if (path === `/api/v4/projects/${id}/merge_requests/11/notes`) return Response.json([]);
    if (path === `/api/v4/projects/${id}/merge_requests/11/diffs`) return Response.json([]);
    return Response.json({}, { status: 404 });
  });
  const { browseGitlabMergeRequest } = await import("../server/modules/gitlab/index.ts");
  const detail = await browseGitlabMergeRequest(repository, 11);
  expect(detail.pipeline).toStrictEqual({
    id: 99,
    name: "",
    status: "running",
    source: "merge_request_event",
    ref: "refs/merge-requests/11/merge",
    sha: "b".repeat(40),
    author: { login: "tanuki", avatarUrl: "" },
    webUrl: "https://gitlab.com/group/project/-/pipelines/99",
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:01:00Z",
    duration: null,
  });
  expect(detail.reviewers).toStrictEqual([
    { login: "rev", avatarUrl: "" },
    { login: "duo", avatarUrl: "" },
  ]);
  expect(detail.approvals).toStrictEqual({
    approvedBy: [{ login: "rev", avatarUrl: "" }],
    required: 2,
    left: 1,
  });
});

test("GitLab merge request files stop at 300 and report truncation", async () => {
  await setup();
  const pages = [];
  mockFetch((address) => {
    const url = new URL(address);
    const path = url.pathname;
    if (path.endsWith("/merge_requests/10"))
      return Response.json(mergeRequestRow({ iid: 10, changes_count: undefined }));
    if (path.endsWith("/merge_requests/10/award_emoji")) return Response.json([]);
    if (path.endsWith("/merge_requests/10/approvals")) return Response.json({ approved_by: [] });
    if (path.endsWith("/merge_requests/10/notes")) return Response.json([]);
    if (path.endsWith("/merge_requests/10/diffs")) {
      const page = Number(url.searchParams.get("page"));
      pages.push(page);
      return Response.json(
        Array.from({ length: 100 }, (_, index) => ({
          old_path: `src/file-${page}-${index}.ts`,
          new_path: `src/file-${page}-${index}.ts`,
          diff: "@@\n-a\n+b",
        })),
        { headers: { "X-Next-Page": String(page + 1) } },
      );
    }
    return Response.json({}, { status: 404 });
  });
  const { browseGitlabMergeRequest } = await import("../server/modules/gitlab/index.ts");
  const detail = await browseGitlabMergeRequest(repository, 10);
  expect(pages).toStrictEqual([1, 2, 3]);
  expect(detail.files).toHaveLength(300);
  expect(detail.filesTruncated).toBe(true);
  expect(detail.changedFiles).toBe(300);
});

test("GitLab tracker errors keep their status and reject bad numbers", async () => {
  await setup();
  let status = 401;
  mockFetch(() => Response.json({}, { status }));
  const {
    browseGitlabIssues,
    browseGitlabIssue,
    browseGitlabMergeRequests,
    browseGitlabMergeRequest,
  } = await import("../server/modules/gitlab/index.ts");
  await expect(browseGitlabIssues(repository)).rejects.toMatchObject({
    status: 401,
    message: /Авторизация GitLab истекла или недействительна/,
  });
  status = 404;
  await expect(browseGitlabMergeRequests(repository)).rejects.toMatchObject({
    status: 404,
    message: /Проект не найден или нет доступа/,
  });
  status = 429;
  await expect(browseGitlabIssue(repository, 1)).rejects.toMatchObject({
    status: 429,
    message: /Превышен лимит GitLab/,
  });
  await expect(browseGitlabIssue(repository, 0)).rejects.toMatchObject({ status: 400 });
  await expect(browseGitlabMergeRequest(repository, -2)).rejects.toMatchObject({ status: 400 });
  await expect(browseGitlabIssues(repository, { page: "0" })).rejects.toMatchObject({
    status: 400,
  });
});
