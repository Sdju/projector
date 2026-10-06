import assert from "node:assert/strict";
import { test, mock } from "node:test";
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
  const disconnect = registerWorkspaceProfile(projectId, createGithubConnectionProfile("vuejs/core"));
  try {
    assert.deepEqual(await workspaceRequest(projectId, "root"), { root: projectId });
    assert.deepEqual(await workspaceRequest(projectId, "tree"), { entries: [], truncated: false });
    assert.ok(Object.values(workspaceCapabilities(projectId)).every((value) => !value));
    await assert.rejects(workspaceRequest(projectId, "file", { path: "README.md" }), /Подключите GitHub/);
    await assert.rejects(workspaceRequest(projectId, "issues"), /недоступно/);
    await assert.rejects(saveWorkspaceFile(projectId, "README.md", "changed", ""), /только для чтения/);
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
    },
  );
  const unregister = registerWorkspaceProfile("remote-test", profile);
  try {
    assert.deepEqual(await workspaceRequest("remote-test", "log", { limit: "50" }), {
      action: "log",
      params: { limit: "50", repository: "octocat/repo", sha: initial.commit },
    });
    const root = await workspaceRequest("remote-test", "tree");
    assert.deepEqual(root.entries[0], {
      name: "src",
      path: "src",
      directory: true,
      executable: false,
      disabled: false,
    });
    assert.equal(root.entries[1].disabled, true);
    const file = await workspaceRequest("remote-test", "file", { path: "src/main.ts" });
    assert.equal(file.readonly, true);
    assert.equal(file.content, "1".repeat(40));
    assert.equal(isEditable({ ...file, key: "file" }), false);
    await workspaceRequest("remote-test", "tree", { path: "src" });
    assert.equal(calls.length, 2);
    assert.ok(workspaceAssetUrl("remote-test", "docs/image.png").includes(initial.tree));
    await profile.providers.files.refresh();
    assert.equal(metadata.length, 1);
    assert.equal((await workspaceRequest("remote-test", "log")).params.sha, "c".repeat(40));
    assert.ok(workspaceAssetUrl("remote-test", "docs/image.png").includes("d".repeat(40)));
    assert.equal(
      (await workspaceRequest("remote-test", "file", { path: "src/main.ts" })).content,
      "2".repeat(40),
    );
    assert.equal(calls.length, 4);
    assert.equal((await workspaceRequest("remote-test", "git")).branch, "main");
    assert.equal(workspaceCapabilities("remote-test").git, true);
    assert.equal(workspaceCapabilities("remote-test").issues, true);
    assert.deepEqual(await workspaceRequest("remote-test", "issues", { state: "open", page: "1" }), {
      action: "issues",
      repository: "octocat/repo",
      params: { state: "open", page: "1" },
    });
    assert.deepEqual(await workspaceRequest("remote-test", "issue", { number: "7" }), {
      action: "issue",
      repository: "octocat/repo",
      number: 7,
    });
    await assert.rejects(workspaceRequest("remote-test", "issue", { number: "nope" }));
    assert.equal(workspaceCapabilities("remote-test").pulls, true);
    assert.deepEqual(await workspaceRequest("remote-test", "pulls", { state: "all" }), {
      action: "pulls",
      repository: "octocat/repo",
      params: { state: "all" },
    });
    assert.deepEqual(await workspaceRequest("remote-test", "pull", { number: "9" }), {
      action: "pull",
      repository: "octocat/repo",
      number: 9,
    });
    await assert.rejects(workspaceRequest("remote-test", "pull", { number: "0" }));
    assert.equal(profile.providers.git.write, undefined);
    for (const action of ["search", "external", "diff"])
      await assert.rejects(workspaceRequest("remote-test", action));
    await assert.rejects(workspaceRequest("remote-test", "file", { path: "../secret" }));
    assert.equal(workspaceCapabilities("remote-test").terminals, false);
    assert.equal(workspaceCapabilities("remote-test").persist, false);
    assert.equal(
      isMarkdown({ path: "README.md", content: "# Readonly", key: "readme", readonly: true }),
      true,
    );
  } finally {
    unregister();
  }
  assert.equal(workspaceCapabilities("local-test").write, true);
});

test("a local project with a GitHub origin keeps local providers and adds issues", async () => {
  const profile = createGithubEnabledLocalProfile("/tmp/app", "octocat/repo");
  assert.equal(profile.id, "local-github");
  assert.ok(profile.sidebar.some((section) => section.id === "issues"));
  assert.ok(profile.sidebar.some((section) => section.id === "pulls"));
  assert.ok(profile.tabs.some((tab) => tab.id === "repository"));
  assert.ok(profile.tabs.some((tab) => tab.id === "issue"));
  assert.ok(profile.tabs.some((tab) => tab.id === "pull"));
  const calls = [];
  const fetch = mock.method(globalThis, "fetch", async (url) => {
    calls.push(String(url));
    return Response.json({ issues: [], next: null });
  });
  const unregister = registerWorkspaceProfile("local-github-test", profile);
  try {
    const capabilities = workspaceCapabilities("local-github-test");
    assert.equal(capabilities.write, true);
    assert.equal(capabilities.git, true);
    assert.equal(capabilities.search, true);
    assert.equal(capabilities.issues, true);
    assert.equal(capabilities.terminals, true);
    await workspaceRequest("local-github-test", "issues", { state: "open", page: "1" });
    assert.match(calls[0], /repository=octocat%2Frepo/);
  } finally {
    fetch.mock.restore();
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
  const fetch = mock.method(globalThis, "fetch", () => {
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
    for (const run of operations) await assert.rejects(run(), /только для чтения/);
    assert.equal(fetch.mock.callCount(), 0);
  } finally {
    fetch.mock.restore();
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
  assert.equal(profiles.resolve("mem:a"), memory);
  assert.equal(profiles.resolve("/tmp/a").id, "fallback");
  const capabilities = profileCapabilities(memory);
  assert.deepEqual(
    [capabilities.write, capabilities.git, capabilities.search, capabilities.terminals],
    [false, true, false, true],
  );
  assert.equal(profileCapabilities(profiles.resolve("/tmp/a")).git, false);
  assert.equal(workspaceProfile("/tmp/local").id, "local");
  assert.equal(profileCapabilities(workspaceProfile("/tmp/local")).write, true);
});
