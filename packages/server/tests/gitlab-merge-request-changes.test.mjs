import { expect, onTestFinished, test, vi } from "vite-plus/test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

process.env.PROJECTOR_SECRET_STORE = "file";

const repository = "gitlab.com/group/project";
const id = encodeURIComponent("group/project");
const base = "a".repeat(40);
const head = "b".repeat(40);

async function setup(url = "https://gitlab.com") {
  const root = await mkdtemp(join(tmpdir(), "projector-gitlab-mr-changes-"));
  process.env.XDG_DATA_HOME = join(root, "data");
  const { updateIntegration } = await import("../modules/integration-store/index.ts");
  await updateIntegration("gitlab", () => ({
    enabled: true,
    settings: { url, directory: join(root, "projects") },
    credentials: {},
  }));
  onTestFinished(async () => {
    vi.restoreAllMocks();
    await rm(root, { recursive: true, force: true });
  });
}

function mockFetch(handler) {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
    expect(init.redirect, "GitLab redirects are forbidden").toBe("error");
    return handler(String(url));
  });
}

function mergeRequest(overrides = {}) {
  return {
    iid: 7,
    title: "Add search",
    state: "opened",
    source_branch: "feat/search",
    target_branch: "main",
    source_project_id: 77,
    target_project_id: 42,
    sha: head,
    changes_count: "3",
    diff_refs: { base_sha: base, start_sha: base, head_sha: head },
    ...overrides,
  };
}

function fileBody(content) {
  return Response.json({ content, encoding: "text", size: content.length });
}

test("GitLab merge request files keep the pinned diff refs and cap changes_count", async () => {
  await setup();
  mockFetch((address) => {
    const url = new URL(address);
    const path = url.pathname;
    if (path.endsWith("/merge_requests/7"))
      return Response.json(mergeRequest({ changes_count: "10" }));
    if (path.endsWith("/merge_requests/7/diffs"))
      return Response.json([
        {
          old_path: "src/app.ts",
          new_path: "src/app.ts",
          diff: "@@\n-a\n+b\n+c",
          generated_file: true,
        },
        { old_path: "old.ts", new_path: "new.ts", renamed_file: true, diff: "@@\n-x\n+y" },
        { old_path: "new.ts", new_path: "new.ts", new_file: true, diff: "@@\n+only" },
        { old_path: "gone.ts", new_path: "gone.ts", deleted_file: true, diff: "@@\n-gone" },
        { old_path: "logo.png", new_path: "logo.png", too_large: true },
      ]);
    return Response.json({}, { status: 404 });
  });
  const { browseGitlabMergeRequestFiles } = await import("../modules/gitlab/index.ts");
  const changes = await browseGitlabMergeRequestFiles(repository, 7);
  expect(changes.diffRefs).toStrictEqual({ baseSha: base, startSha: base, headSha: head });
  expect(changes.changedFiles).toBe(10);
  expect(changes.changedFilesCapped).toBe(false);
  expect(changes.filesTruncated).toBe(true);
  expect(changes.files).toStrictEqual([
    {
      path: "src/app.ts",
      previousPath: "",
      status: "modified",
      additions: 2,
      deletions: 1,
      generated: true,
    },
    { path: "new.ts", previousPath: "old.ts", status: "renamed", additions: 1, deletions: 1 },
    { path: "new.ts", previousPath: "", status: "added", additions: 1, deletions: 0 },
    { path: "gone.ts", previousPath: "", status: "removed", additions: 0, deletions: 1 },
    {
      path: "logo.png",
      previousPath: "",
      status: "modified",
      additions: 0,
      deletions: 0,
      binary: true,
      tooLarge: true,
    },
  ]);
});

test("GitLab merge request files treat changes_count 1000+ as capped", async () => {
  await setup();
  mockFetch((address) => {
    const url = new URL(address);
    const path = url.pathname;
    if (path.endsWith("/merge_requests/8"))
      return Response.json(mergeRequest({ iid: 8, changes_count: "1000+" }));
    if (path.endsWith("/merge_requests/8/diffs"))
      return Response.json([
        { old_path: "a.ts", new_path: "a.ts", diff: "@@\n-a\n+b" },
        { old_path: "b.ts", new_path: "b.ts", diff: "@@\n-a\n+b" },
      ]);
    return Response.json({}, { status: 404 });
  });
  const { browseGitlabMergeRequestFiles } = await import("../modules/gitlab/index.ts");
  const changes = await browseGitlabMergeRequestFiles(repository, 8);
  expect(changes.changedFiles).toBe(1000);
  expect(changes.changedFilesCapped).toBe(true);
  expect(changes.filesTruncated).toBe(true);
  expect(changes.files).toHaveLength(2);
});

test("GitLab merge request diff reads both pinned sides and handles added/deleted files", async () => {
  await setup();
  const reads = [];
  mockFetch((address) => {
    const url = new URL(address);
    const path = url.pathname;
    if (path.endsWith("/merge_requests/7"))
      return Response.json(
        mergeRequest({
          diff_refs: { base_sha: base, start_sha: base, head_sha: head },
        }),
      );
    if (path.endsWith("/merge_requests/7/diffs"))
      return Response.json([
        { old_path: "src/app.ts", new_path: "src/app.ts", diff: "@@\n-a\n+b" },
        { old_path: "old.ts", new_path: "new.ts", renamed_file: true, diff: "@@\n-x\n+y" },
        { old_path: "added.ts", new_path: "added.ts", new_file: true, diff: "@@\n+only" },
        { old_path: "gone.ts", new_path: "gone.ts", deleted_file: true, diff: "@@\n-gone" },
      ]);
    if (path.includes("/repository/files/")) {
      reads.push({
        project: path.split("/")[4],
        path: decodeURIComponent(path.split("/files/")[1]),
        ref: url.searchParams.get("ref"),
      });
      const filePath = decodeURIComponent(path.split("/files/")[1]);
      return fileBody(
        filePath === "src/app.ts"
          ? url.searchParams.get("ref") === base
            ? "old app"
            : "new app"
          : filePath === "old.ts"
            ? "old name"
            : filePath === "new.ts"
              ? "new name"
              : filePath === "added.ts"
                ? "added"
                : "gone",
      );
    }
    return Response.json({}, { status: 404 });
  });
  const { browseGitlabMergeRequestDiff } = await import("../modules/gitlab/index.ts");
  const modified = await browseGitlabMergeRequestDiff(repository, 7, "src/app.ts");
  expect(modified).toStrictEqual({
    path: "src/app.ts",
    original: "old app",
    modified: "new app",
    hash: head,
    parent: base.slice(0, 7),
    binary: false,
    tooLarge: false,
  });
  const renamed = await browseGitlabMergeRequestDiff(repository, 7, "new.ts");
  expect(renamed.original).toBe("old name");
  expect(renamed.modified).toBe("new name");
  const added = await browseGitlabMergeRequestDiff(repository, 7, "added.ts");
  expect(added.original).toBe("");
  expect(added.modified).toBe("added");
  const removed = await browseGitlabMergeRequestDiff(repository, 7, "gone.ts");
  expect(removed.original).toBe("gone");
  expect(removed.modified).toBe("");
  // Base reads from the target project, head reads from the fork (source project).
  expect(reads[0]).toStrictEqual({ project: id, path: "src/app.ts", ref: base });
  expect(reads[1]).toStrictEqual({ project: "77", path: "src/app.ts", ref: head });
});

test("GitLab merge request diff reports binary, too large, missing refs and unknown files", async () => {
  await setup();
  let refs = { base_sha: base, start_sha: base, head_sha: head };
  let files = [
    { old_path: "logo.png", new_path: "logo.png" },
    { old_path: "huge.bin", new_path: "huge.bin", too_large: true },
  ];
  mockFetch((address) => {
    const url = new URL(address);
    const path = url.pathname;
    if (path.endsWith("/merge_requests/7"))
      return Response.json(mergeRequest({ diff_refs: refs, changes_count: "2" }));
    if (path.endsWith("/merge_requests/7/diffs")) return Response.json(files);
    return Response.json({}, { status: 404 });
  });
  const { browseGitlabMergeRequestDiff } = await import("../modules/gitlab/index.ts");
  expect(await browseGitlabMergeRequestDiff(repository, 7, "logo.png")).toMatchObject({
    binary: true,
    tooLarge: false,
    original: "",
    modified: "",
  });
  expect(await browseGitlabMergeRequestDiff(repository, 7, "huge.bin")).toMatchObject({
    binary: false,
    tooLarge: true,
    original: "",
    modified: "",
  });
  await expect(browseGitlabMergeRequestDiff(repository, 7, "missing.ts")).rejects.toMatchObject({
    status: 404,
  });
  refs = null;
  await expect(browseGitlabMergeRequestDiff(repository, 7, "logo.png")).rejects.toMatchObject({
    status: 409,
  });
  await expect(browseGitlabMergeRequestDiff(repository, 0, "logo.png")).rejects.toMatchObject({
    status: 400,
  });
});

test("GitLab merge request diff turns an oversized side into tooLarge", async () => {
  await setup();
  mockFetch((address) => {
    const url = new URL(address);
    const path = url.pathname;
    if (path.endsWith("/merge_requests/7")) return Response.json(mergeRequest());
    if (path.endsWith("/merge_requests/7/diffs"))
      return Response.json([{ old_path: "big.ts", new_path: "big.ts", diff: "@@\n-a\n+b" }]);
    if (path.includes("/repository/files/")) return Response.json({ size: 6 * 1024 * 1024 });
    return Response.json({}, { status: 404 });
  });
  const { browseGitlabMergeRequestDiff } = await import("../modules/gitlab/index.ts");
  expect(await browseGitlabMergeRequestDiff(repository, 7, "big.ts")).toMatchObject({
    tooLarge: true,
    original: "",
    modified: "",
  });
});
