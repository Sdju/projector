import { expect, test, vi } from "vite-plus/test";
import {
  createGitlabConnectionProfile,
  createGitlabEnabledLocalProfile,
  createGitlabWorkspaceProfile,
} from "../src/modules/gitlab-workspace/source.ts";
import {
  GitlabRequestError,
  readIssues,
  readJob,
  readMergeRequest,
  readPipeline,
  readPipelines,
} from "../src/modules/gitlab-workspace/client.ts";
import {
  moveWorkspaceEntry,
  mutateWorkspaceEntry,
  mutateWorkspaceGit,
  registerWorkspaceProfile,
  saveWorkspaceFile,
  workspaceAssetUrl,
  workspaceCapabilities,
  workspaceProfile,
  workspaceRequest,
} from "../src/modules/workspace-api/index.ts";

const REPOSITORY = "gitlab.com/group/sub/project";
const COMMIT = "a".repeat(40);
const NEXT_COMMIT = "c".repeat(40);

test("GitLab authentication opens an empty workspace without local or remote data access", async () => {
  const projectId = `gl:/${REPOSITORY}`;
  const disconnect = registerWorkspaceProfile(
    projectId,
    createGitlabConnectionProfile("gitlab.com", "group/sub/project"),
  );
  try {
    expect(await workspaceRequest(projectId, "root")).toStrictEqual({ root: projectId });
    expect(await workspaceRequest(projectId, "tree")).toStrictEqual({
      entries: [],
      truncated: false,
    });
    expect(Object.values(workspaceCapabilities(projectId)).every((value) => !value)).toBeTruthy();
    await expect(workspaceRequest(projectId, "file", { path: "README.md" })).rejects.toThrow(
      /Подключите GitLab/,
    );
    await expect(workspaceRequest(projectId, "issues")).rejects.toThrow(/недоступно/);
    await expect(saveWorkspaceFile(projectId, "README.md", "changed", "")).rejects.toThrow(
      /только для чтения/,
    );
  } finally {
    disconnect();
  }
});

test("the readonly GitLab source reads tree, files, history, issues and merge requests", async () => {
  const initial = {
    fullName: "group/sub/project",
    branch: "main",
    commit: COMMIT,
    empty: false,
    private: false,
    defaultBranch: "main",
  };
  let revision = 0;
  const treeCalls = [];
  const repositoryCalls = [];
  const fileCalls = [];
  const metadata = [];
  const profile = createGitlabWorkspaceProfile(
    REPOSITORY,
    "gitlab.com",
    "group/sub/project",
    initial,
    "main",
    (value) => metadata.push(value),
    {
      async readRepository(repository, ref) {
        revision++;
        repositoryCalls.push({ repository, ref });
        return { ...initial, commit: NEXT_COMMIT };
      },
      async readTree(repository, sha, path) {
        treeCalls.push({ repository, sha, path });
        if (path === "src")
          return {
            truncated: false,
            entries: [
              { name: "main.ts", path: "src/main.ts", type: "blob", mode: "100644", size: 8 },
            ],
          };
        return {
          truncated: false,
          entries: [
            { name: "src", path: "src", type: "tree", mode: "040000", size: 0 },
            { name: "module", path: "module", type: "commit", mode: "160000", size: 0 },
            { name: "run.sh", path: "run.sh", type: "blob", mode: "100755", size: 12 },
          ],
        };
      },
      async readFile(repository, sha, path) {
        fileCalls.push({ repository, sha, path });
        return {
          content: sha,
          image: path.endsWith(".svg")
            ? "data:image/svg+xml;base64,AA=="
            : path.endsWith(".png")
              ? "data:image/png;base64,AA=="
              : null,
          binary: false,
          size: 40,
        };
      },
      async readGit(action, params) {
        return { action, params };
      },
      async readIssues(repository, params) {
        return { action: "issues", repository, params };
      },
      async readIssue(repository, number) {
        return { action: "issue", repository, number };
      },
      async readMergeRequests(repository, params) {
        return { action: "merge-requests", repository, params };
      },
      async readMergeRequest(repository, number) {
        return { action: "merge-request", repository, number };
      },
      async readPipelines(repository, params) {
        return { action: "pipelines", repository, params };
      },
      async readPipeline(repository, id) {
        return { action: "pipeline", repository, id };
      },
      async readJob(repository, id) {
        return { action: "job", repository, id };
      },
    },
  );
  const projectId = "gitlab-workspace-test";
  const unregister = registerWorkspaceProfile(projectId, profile);
  try {
    expect(profile.id).toBe("gitlab");
    expect(profile.layout).toBe("editor");
    expect(profile.sidebar.map((section) => section.id)).toStrictEqual([
      "issues",
      "merge-requests",
      "pipelines",
    ]);
    expect(profile.tabs.map((tab) => tab.id)).toStrictEqual([
      "gitlab-integration",
      "repository",
      "issue",
      "pull",
      "pipeline",
      "job",
    ]);
    expect(profile.features).toStrictEqual({
      terminals: false,
      docker: false,
      agent: false,
      settings: false,
      persist: false,
      externalFiles: false,
    });
    expect(await workspaceRequest(projectId, "root")).toStrictEqual({
      root: `gl:/${REPOSITORY}`,
    });

    const root = await workspaceRequest(projectId, "tree");
    expect(root.entries.map((entry) => entry.path)).toStrictEqual(["src", "module", "run.sh"]);
    expect(root.entries[0]).toStrictEqual({
      name: "src",
      path: "src",
      directory: true,
      executable: false,
      disabled: false,
    });
    expect(root.entries[1].disabled).toBe(true);
    expect(root.entries[2].executable).toBe(true);

    const firstPage = await workspaceRequest(projectId, "tree", { limit: "1" });
    expect(firstPage.entries.length).toBe(1);
    expect(firstPage.total).toBe(3);
    expect(firstPage.truncated).toBe(true);
    expect(firstPage.nextOffset).toBe(1);

    const folder = await workspaceRequest(projectId, "tree", { path: "src" });
    expect(folder.entries[0]).toStrictEqual({
      name: "main.ts",
      path: "src/main.ts",
      directory: false,
      executable: false,
      disabled: false,
    });
    expect(treeCalls.at(-1)).toStrictEqual({
      repository: REPOSITORY,
      sha: COMMIT,
      path: "src",
    });

    const file = await workspaceRequest(projectId, "file", { path: "src/main.ts" });
    expect(file.readonly).toBe(true);
    expect(file.content).toBe(COMMIT);
    expect(file.image).toBe(false);
    expect(fileCalls.at(-1)).toStrictEqual({
      repository: REPOSITORY,
      sha: COMMIT,
      path: "src/main.ts",
    });
    // SVG is rendered as text, images keep their data URL.
    expect((await workspaceRequest(projectId, "file", { path: "logo.svg" })).image).toBe(false);
    expect((await workspaceRequest(projectId, "file", { path: "logo.png" })).image).toBe(true);
    await expect(workspaceRequest(projectId, "file", { path: "../secret" })).rejects.toThrow(
      /Неверный путь файла/,
    );
    expect(workspaceAssetUrl(projectId, "docs/image.png")).toBe(
      `/api/integrations/gitlab/browse/asset?${new URLSearchParams({
        repository: REPOSITORY,
        sha: COMMIT,
        path: "docs/image.png",
      })}`,
    );

    expect(await workspaceRequest(projectId, "git")).toStrictEqual({
      available: true,
      branch: "main",
      changes: [],
    });
    expect(await workspaceRequest(projectId, "gutter", { path: "src/main.ts" })).toStrictEqual({
      available: false,
      original: "",
    });
    expect(await workspaceRequest(projectId, "log", { limit: "50" })).toStrictEqual({
      action: "log",
      params: { limit: "50", repository: REPOSITORY, sha: COMMIT },
    });
    expect(await workspaceRequest(projectId, "commit", { hash: "abc1234" })).toStrictEqual({
      action: "commit",
      params: { hash: "abc1234", repository: REPOSITORY, sha: COMMIT },
    });
    expect(
      await workspaceRequest(projectId, "commit-diff", { hash: "abc1234", path: "src/main.ts" }),
    ).toStrictEqual({
      action: "commit-diff",
      params: { hash: "abc1234", path: "src/main.ts", repository: REPOSITORY, sha: COMMIT },
    });
    for (const action of ["branches", "diff", "search", "external"])
      await expect(workspaceRequest(projectId, action)).rejects.toThrow();

    expect(await workspaceRequest(projectId, "issues", { state: "open", page: "1" })).toStrictEqual(
      {
        action: "issues",
        repository: REPOSITORY,
        params: { state: "open", page: "1" },
      },
    );
    expect(await workspaceRequest(projectId, "issue", { number: "7" })).toStrictEqual({
      action: "issue",
      repository: REPOSITORY,
      number: 7,
    });
    await expect(workspaceRequest(projectId, "issue", { number: "nope" })).rejects.toThrow();
    expect(await workspaceRequest(projectId, "pulls", { state: "all" })).toStrictEqual({
      action: "merge-requests",
      repository: REPOSITORY,
      params: { state: "all" },
    });
    expect(await workspaceRequest(projectId, "pull", { number: "9" })).toStrictEqual({
      action: "merge-request",
      repository: REPOSITORY,
      number: 9,
    });
    await expect(workspaceRequest(projectId, "pull", { number: "0" })).rejects.toThrow();
    expect(
      await workspaceRequest(projectId, "pipelines", { status: "failed", page: "1" }),
    ).toStrictEqual({
      action: "pipelines",
      repository: REPOSITORY,
      params: { status: "failed", page: "1" },
    });
    expect(await workspaceRequest(projectId, "pipeline", { id: "42" })).toStrictEqual({
      action: "pipeline",
      repository: REPOSITORY,
      id: 42,
    });
    expect(await workspaceRequest(projectId, "job", { id: "7" })).toStrictEqual({
      action: "job",
      repository: REPOSITORY,
      id: 7,
    });
    await expect(workspaceRequest(projectId, "pipeline", { id: "0" })).rejects.toThrow();
    await expect(workspaceRequest(projectId, "job", { id: "nope" })).rejects.toThrow();

    const capabilities = workspaceCapabilities(projectId);
    expect(capabilities.write).toBe(false);
    expect(capabilities.git).toBe(true);
    expect(capabilities.search).toBe(false);
    expect(capabilities.issues).toBe(true);
    expect(capabilities.pulls).toBe(true);
    expect(capabilities.discussions).toBe(false);
    expect(capabilities.pipelines).toBe(true);
    expect(capabilities.terminals).toBe(false);
    expect(capabilities.persist).toBe(false);
    expect(capabilities.externalFiles).toBe(false);

    await profile.providers.files.refresh();
    expect(repositoryCalls).toStrictEqual([{ repository: REPOSITORY, ref: "main" }]);
    expect(revision).toBe(1);
    expect(metadata.length).toBe(1);
    expect(workspaceAssetUrl(projectId, "docs/image.png").includes(NEXT_COMMIT)).toBeTruthy();
    expect((await workspaceRequest(projectId, "log")).params.sha).toBe(NEXT_COMMIT);
    expect((await workspaceRequest(projectId, "file", { path: "src/main.ts" })).content).toBe(
      NEXT_COMMIT,
    );

    for (const run of [
      () => saveWorkspaceFile(projectId, "file", "next", "old"),
      () => moveWorkspaceEntry(projectId, "file", "dir"),
      () => mutateWorkspaceEntry(projectId, "delete", "file"),
      () => mutateWorkspaceGit(projectId, "stage", "file"),
    ])
      await expect(run()).rejects.toThrow(/только для чтения/);
  } finally {
    unregister();
  }
});

test("a local project with a GitLab origin keeps local providers and adds trackers", () => {
  const profile = createGitlabEnabledLocalProfile("/tmp/app", "gitlab.com", "group/sub/project");
  expect(profile.id).toBe("local-gitlab");
  expect(profile.features.terminals).toBe(true);
  expect(profile.providers.files.write).toBeTruthy();
  expect(profile.sidebar.some((section) => section.id === "merge-requests")).toBe(true);
  expect(profile.sidebar.some((section) => section.id === "pipelines")).toBe(true);
  expect(profile.tabs.some((tab) => tab.id === "pull")).toBe(true);
  expect(profile.tabs.some((tab) => tab.id === "pipeline")).toBe(true);
  expect(profile.tabs.some((tab) => tab.id === "job")).toBe(true);
  expect(profile.tabs.some((tab) => tab.id === "repository")).toBe(true);
});

test("the GitLab resolver claims gl:/ projects instead of falling back to local files", async () => {
  await import("../src/modules/gitlab-workspace/resolve.ts");
  expect(() => workspaceProfile("gl:/gitlab.com/group/missing")).toThrow(/GitLab/);
});

test("the GitLab client targets browse actions and reports the HTTP status", async () => {
  const fetch = vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(async () => Response.json({ ok: true }));
  try {
    expect(await readIssues(REPOSITORY, { state: "open" })).toStrictEqual({ ok: true });
    expect(fetch.mock.calls[0][0]).toBe(
      `/api/integrations/gitlab/browse/issues?${new URLSearchParams({
        repository: REPOSITORY,
        state: "open",
      })}`,
    );
    fetch.mockResolvedValueOnce(Response.json({ error: "Нет доступа" }, { status: 403 }));
    const error = await readMergeRequest(REPOSITORY, 3).catch((err) => err);
    expect(error).toBeInstanceOf(GitlabRequestError);
    expect(error.status).toBe(403);
    expect(error.message).toBe("Нет доступа");
    expect(String(fetch.mock.calls[1][0])).toBe(
      `/api/integrations/gitlab/browse/merge-request?${new URLSearchParams({
        repository: REPOSITORY,
        number: "3",
      })}`,
    );
    expect(await readPipelines(REPOSITORY, { status: "failed" })).toStrictEqual({ ok: true });
    expect(String(fetch.mock.calls[2][0])).toBe(
      `/api/integrations/gitlab/browse/pipelines?${new URLSearchParams({
        repository: REPOSITORY,
        status: "failed",
      })}`,
    );
    expect(await readPipeline(REPOSITORY, 42)).toStrictEqual({ ok: true });
    expect(String(fetch.mock.calls[3][0])).toBe(
      `/api/integrations/gitlab/browse/pipeline?${new URLSearchParams({
        repository: REPOSITORY,
        id: "42",
      })}`,
    );
    expect(await readJob(REPOSITORY, 7)).toStrictEqual({ ok: true });
    expect(String(fetch.mock.calls[4][0])).toBe(
      `/api/integrations/gitlab/browse/job?${new URLSearchParams({
        repository: REPOSITORY,
        id: "7",
      })}`,
    );
  } finally {
    fetch.mockRestore();
  }
});
