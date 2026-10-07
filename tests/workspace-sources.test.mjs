import { expect, test, vi } from "vite-plus/test";
import {
  createGithubConnectionProfile,
  createGithubEnabledLocalProfile,
  createGithubWorkspaceProfile,
} from "../src/modules/github-workspace/source.ts";
import {
  registerWorkspaceProfile,
  workspaceCapabilities,
  workspaceRequest,
  workspaceAssetUrl,
  saveWorkspaceFile,
  moveWorkspaceEntry,
  mutateWorkspaceEntry,
  mutateWorkspaceGit,
  mutateWorkspaceBranch,
} from "../src/modules/workspace-api/index.ts";
import { isEditable, isMarkdown } from "../src/modules/workspace/open-file.ts";

test("GitHub authentication opens an empty workspace without local or remote data access", async () => {
  const projectId = "gh:/vuejs/core";
  const disconnect = registerWorkspaceProfile(
    projectId,
    createGithubConnectionProfile("vuejs/core"),
  );
  try {
    expect(await workspaceRequest(projectId, "root")).toStrictEqual({ root: projectId });
    expect(await workspaceRequest(projectId, "tree")).toStrictEqual({
      entries: [],
      truncated: false,
    });
    expect(Object.values(workspaceCapabilities(projectId)).every((value) => !value)).toBeTruthy();
    await expect(workspaceRequest(projectId, "file", { path: "README.md" })).rejects.toThrow(
      /Подключите GitHub/,
    );
    await expect(workspaceRequest(projectId, "issues")).rejects.toThrow(/недоступно/);
    await expect(saveWorkspaceFile(projectId, "README.md", "changed", "")).rejects.toThrow(
      /только для чтения/,
    );
  } finally {
    disconnect();
  }
});

test("the shared workspace uses a readonly source for tree, files, assets and refresh", async () => {
  const initial = {
    fullName: "octocat/repo",
    branch: "main",
    commit: "a".repeat(40),
    tree: "b".repeat(40),
    empty: false,
    private: false,
    description: "",
  };
  let revision = 0;
  const calls = [];
  const metadata = [];
  const profile = createGithubWorkspaceProfile(
    "octocat/repo",
    initial,
    "",
    (value) => metadata.push(value),
    {
      async readGit(action, params) {
        return { action, params };
      },
      async readRepository() {
        revision++;
        return { ...initial, commit: "c".repeat(40), tree: "d".repeat(40) };
      },
      async readTree(repository, sha) {
        calls.push(sha);
        return {
          truncated: false,
          entries:
            sha === "e".repeat(40)
              ? [
                  {
                    name: "main.ts",
                    type: "blob",
                    sha: revision ? "2".repeat(40) : "1".repeat(40),
                    mode: "100644",
                    size: 8,
                  },
                ]
              : [
                  { name: "src", type: "tree", sha: "e".repeat(40), mode: "040000", size: 0 },
                  { name: "module", type: "commit", sha: "f".repeat(40), mode: "160000", size: 0 },
                ],
        };
      },
      async readFile(repository, sha) {
        return { content: sha, binary: false, image: null, size: 40 };
      },
      async readIssues(repository, params) {
        return { action: "issues", repository, params };
      },
      async readIssue(repository, number) {
        return { action: "issue", repository, number };
      },
      async readPulls(repository, params) {
        return { action: "pulls", repository, params };
      },
      async readPull(repository, number) {
        return { action: "pull", repository, number };
      },
      async readDiscussions(repository, params) {
        return { action: "discussions", repository, params };
      },
      async readDiscussion(repository, number) {
        return { action: "discussion", repository, number };
      },
    },
  );
  const unregister = registerWorkspaceProfile("remote-test", profile);
  try {
    expect(await workspaceRequest("remote-test", "log", { limit: "50" })).toStrictEqual({
      action: "log",
      params: { limit: "50", repository: "octocat/repo", sha: initial.commit },
    });
    const root = await workspaceRequest("remote-test", "tree");
    expect(root.entries[0]).toStrictEqual({
      name: "src",
      path: "src",
      directory: true,
      executable: false,
      disabled: false,
    });
    expect(root.entries[1].disabled).toBe(true);
    const file = await workspaceRequest("remote-test", "file", { path: "src/main.ts" });
    expect(file.readonly).toBe(true);
    expect(file.content).toBe("1".repeat(40));
    expect(isEditable({ ...file, key: "file" })).toBe(false);
    await workspaceRequest("remote-test", "tree", { path: "src" });
    expect(calls.length).toBe(2);
    expect(workspaceAssetUrl("remote-test", "docs/image.png").includes(initial.tree)).toBeTruthy();
    await profile.providers.files.refresh();
    expect(metadata.length).toBe(1);
    expect((await workspaceRequest("remote-test", "log")).params.sha).toBe("c".repeat(40));
    expect(
      workspaceAssetUrl("remote-test", "docs/image.png").includes("d".repeat(40)),
    ).toBeTruthy();
    expect((await workspaceRequest("remote-test", "file", { path: "src/main.ts" })).content).toBe(
      "2".repeat(40),
    );
    expect(calls.length).toBe(4);
    expect((await workspaceRequest("remote-test", "git")).branch).toBe("main");
    expect(workspaceCapabilities("remote-test").git).toBe(true);
    expect(workspaceCapabilities("remote-test").issues).toBe(true);
    expect(
      await workspaceRequest("remote-test", "issues", { state: "open", page: "1" }),
    ).toStrictEqual({
      action: "issues",
      repository: "octocat/repo",
      params: { state: "open", page: "1" },
    });
    expect(await workspaceRequest("remote-test", "issue", { number: "7" })).toStrictEqual({
      action: "issue",
      repository: "octocat/repo",
      number: 7,
    });
    await expect(workspaceRequest("remote-test", "issue", { number: "nope" })).rejects.toThrow();
    expect(workspaceCapabilities("remote-test").pulls).toBe(true);
    expect(await workspaceRequest("remote-test", "pulls", { state: "all" })).toStrictEqual({
      action: "pulls",
      repository: "octocat/repo",
      params: { state: "all" },
    });
    expect(await workspaceRequest("remote-test", "pull", { number: "9" })).toStrictEqual({
      action: "pull",
      repository: "octocat/repo",
      number: 9,
    });
    await expect(workspaceRequest("remote-test", "pull", { number: "0" })).rejects.toThrow();
    expect(workspaceCapabilities("remote-test").discussions).toBe(true);
    expect(
      await workspaceRequest("remote-test", "discussions", { page: "Y3Vyc29y" }),
    ).toStrictEqual({
      action: "discussions",
      repository: "octocat/repo",
      params: { page: "Y3Vyc29y" },
    });
    expect(await workspaceRequest("remote-test", "discussion", { number: "4" })).toStrictEqual({
      action: "discussion",
      repository: "octocat/repo",
      number: 4,
    });
    expect(profile.providers.git.write).toBe(undefined);
    for (const action of ["search", "external", "diff"])
      await expect(workspaceRequest("remote-test", action)).rejects.toThrow();
    await expect(workspaceRequest("remote-test", "file", { path: "../secret" })).rejects.toThrow();
    expect(workspaceCapabilities("remote-test").terminals).toBe(false);
    expect(workspaceCapabilities("remote-test").persist).toBe(false);
    expect(
      isMarkdown({ path: "README.md", content: "# Readonly", key: "readme", readonly: true }),
    ).toBe(true);
  } finally {
    unregister();
  }
  expect(workspaceCapabilities("local-test").write).toBe(true);
});

test("a local project with a GitHub origin keeps local providers and adds issues", async () => {
  const profile = createGithubEnabledLocalProfile("/tmp/app", "octocat/repo");
  expect(profile.id).toBe("local-github");
  expect(profile.sidebar.some((section) => section.id === "issues")).toBeTruthy();
  expect(profile.sidebar.some((section) => section.id === "pulls")).toBeTruthy();
  expect(profile.tabs.some((tab) => tab.id === "repository")).toBeTruthy();
  expect(profile.tabs.some((tab) => tab.id === "issue")).toBeTruthy();
  expect(profile.tabs.some((tab) => tab.id === "pull")).toBeTruthy();
  expect(profile.sidebar.some((section) => section.id === "discussions")).toBeTruthy();
  expect(profile.tabs.some((tab) => tab.id === "discussion")).toBeTruthy();
  const calls = [];
  const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
    calls.push(String(url));
    return Response.json({ issues: [], next: null });
  });
  const unregister = registerWorkspaceProfile("local-github-test", profile);
  try {
    const capabilities = workspaceCapabilities("local-github-test");
    expect(capabilities.write).toBe(true);
    expect(capabilities.git).toBe(true);
    expect(capabilities.search).toBe(true);
    expect(capabilities.issues).toBe(true);
    expect(capabilities.terminals).toBe(true);
    await workspaceRequest("local-github-test", "issues", { state: "open", page: "1" });
    expect(calls[0]).toMatch(/repository=octocat%2Frepo/);
  } finally {
    fetch.mockRestore();
    unregister();
  }
});

test("readonly guards reject all shared write helpers before any HTTP request", async () => {
  const unregister = registerWorkspaceProfile("readonly-test", {
    id: "readonly",
    layout: "editor",
    features: {},
    providers: {
      files: {
        read: async () => {
          throw new Error("unexpected read");
        },
        assetUrl: () => "",
      },
    },
  });
  const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(() => {
    throw new Error("unexpected network mutation");
  });
  try {
    const operations = [
      () => saveWorkspaceFile("readonly-test", "file", "next", "old"),
      () => moveWorkspaceEntry("readonly-test", "file", "dir"),
      () => mutateWorkspaceEntry("readonly-test", "delete", "file"),
      () => mutateWorkspaceGit("readonly-test", "stage", "file"),
      () => mutateWorkspaceBranch("readonly-test", "checkout", { name: "main" }),
    ];
    for (const run of operations) await expect(run()).rejects.toThrow(/только для чтения/);
    expect(fetch.mock.calls.length).toBe(0);
  } finally {
    fetch.mockRestore();
    unregister();
  }
});

test("a profile is a set of replaceable providers and capabilities follow from them", async () => {
  const { createWorkspaceProfiles, profileCapabilities, workspaceProfile } =
    await import("../src/modules/workspace-api/index.ts");
  const calls = [];
  const memory = {
    id: "memory",
    layout: "editor",
    features: { terminals: true },
    providers: {
      files: { read: async (action) => (calls.push(action), { entries: [] }), assetUrl: () => "" },
      git: { read: async () => ({ branch: "x" }), write: async () => ({}) },
    },
  };
  const profiles = createWorkspaceProfiles(
    [{ match: (id) => id.startsWith("mem:"), create: () => memory }],
    () => ({ ...memory, id: "fallback", providers: { files: memory.providers.files } }),
  );
  expect(profiles.resolve("mem:a")).toBe(memory);
  expect(profiles.resolve("/tmp/a").id).toBe("fallback");
  const capabilities = profileCapabilities(memory);
  expect([
    capabilities.write,
    capabilities.git,
    capabilities.search,
    capabilities.terminals,
  ]).toStrictEqual([false, true, false, true]);
  expect(profileCapabilities(profiles.resolve("/tmp/a")).git).toBe(false);
  expect(workspaceProfile("/tmp/local").id).toBe("local");
  expect(profileCapabilities(workspaceProfile("/tmp/local")).write).toBe(true);
});
