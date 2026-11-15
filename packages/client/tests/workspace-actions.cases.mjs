import { expect, test, vi } from "vite-plus/test";
import {
  READ_ACTION_DOMAINS,
  connectionFilesProvider,
  createBrowseReader,
  numberedReadProvider,
  readonlyFileContent,
  readonlyWorkspaceFeatures,
  registerWorkspaceProfile,
  snapshotGitProvider,
  snapshotTreePage,
  workspaceRequest,
  workspaceScopeRequest,
  WorkspaceRequestError,
} from "../modules/workspace-api/index.ts";
import { GithubRequestError } from "../modules/github-workspace/client.ts";
import { GitlabRequestError } from "../modules/gitlab-workspace/client.ts";

test("every read action names one provider domain", () => {
  const domains = new Set([
    "files",
    "git",
    "search",
    "issues",
    "pulls",
    "discussions",
    "pipelines",
    "releases",
  ]);
  for (const [action, domain] of Object.entries(READ_ACTION_DOMAINS)) {
    expect(domains.has(domain), `${action}: ${domain}`).toBe(true);
  }
  expect(READ_ACTION_DOMAINS.tree).toBe("files");
  expect(READ_ACTION_DOMAINS.log).toBe("git");
  expect(READ_ACTION_DOMAINS.search).toBe("search");
  expect(READ_ACTION_DOMAINS["pull-diff"]).toBe("pulls");
  expect(READ_ACTION_DOMAINS["job"]).toBe("pipelines");
  expect(READ_ACTION_DOMAINS["release"]).toBe("releases");
});

test("typed read actions route to their provider and add scope parameters", async () => {
  const calls = [];
  const provider = async (action, params) => {
    calls.push({ action, params });
    return { action, params };
  };
  const unregister = registerWorkspaceProfile("typed-actions-test", {
    id: "typed-actions",
    layout: "editor",
    features: {},
    providers: {
      files: { read: provider, assetUrl: () => "" },
      git: { read: provider },
      search: { read: provider },
      issues: { read: provider },
      pulls: { read: provider },
      discussions: { read: provider },
      pipelines: { read: provider },
      releases: { read: provider },
    },
  });
  try {
    await workspaceRequest("typed-actions-test", "issue", { number: "7" });
    await workspaceRequest("typed-actions-test", "log", { limit: "50" });
    await workspaceRequest("typed-actions-test", "search", { q: "needle" });
    await workspaceScopeRequest(
      "typed-actions-test",
      { kind: "compare", from: "a".repeat(40), to: "b".repeat(40) },
      "changes",
    );
    expect(calls).toStrictEqual([
      { action: "issue", params: { number: "7" } },
      { action: "log", params: { limit: "50" } },
      { action: "search", params: { q: "needle" } },
      { action: "changes", params: { from: "a".repeat(40), to: "b".repeat(40) } },
    ]);
    await expect(workspaceRequest("typed-actions-test", "nope")).rejects.toThrow(
      /Неизвестное действие/,
    );
  } finally {
    unregister();
  }
});

test("the shared browse reader reports status, message and body of an HTTP error", async () => {
  const reader = createBrowseReader("/api/integrations/example/browse", "Не удалось прочитать");
  const fetch = vi.spyOn(globalThis, "fetch");
  try {
    fetch.mockResolvedValueOnce(
      Response.json({ error: "Нет доступа", scope: "issues" }, { status: 403 }),
    );
    const error = await reader("issues", { repository: "octo/repo" }).catch((value) => value);
    expect(error).toBeInstanceOf(WorkspaceRequestError);
    expect(error.status).toBe(403);
    expect(error.message).toBe("Нет доступа");
    expect(error.body).toStrictEqual({ error: "Нет доступа", scope: "issues" });
    expect(fetch.mock.calls[0][0]).toBe(
      `/api/integrations/example/browse/issues?${new URLSearchParams({ repository: "octo/repo" })}`,
    );

    fetch.mockResolvedValueOnce(Response.json({ failed: true }, { status: 502 }));
    const noMessage = await reader("issue", { number: "1" }).catch((value) => value);
    expect(noMessage.message).toBe("Не удалось прочитать");
    expect(noMessage.body).toStrictEqual({ failed: true });

    fetch.mockResolvedValueOnce(Response.json({ ok: true }));
    expect(await reader("tree", { sha: "c1" })).toStrictEqual({ ok: true });
  } finally {
    fetch.mockRestore();
  }
});

test("GitHub and GitLab share the neutral HTTP error type", () => {
  expect(GithubRequestError).toBe(WorkspaceRequestError);
  expect(GitlabRequestError).toBe(WorkspaceRequestError);
});

test("the shared numbered provider serves a list and validates one record number", async () => {
  const provider = numberedReadProvider(
    "issues",
    "issue",
    "issue",
    "octo/repo",
    async (repository, params) => ({ repository, params }),
    async (repository, number) => ({ repository, number }),
  );
  expect(await provider.read("issues", { state: "open" })).toStrictEqual({
    repository: "octo/repo",
    params: { state: "open" },
  });
  expect(await provider.read("issue", { number: "5" })).toStrictEqual({
    repository: "octo/repo",
    number: 5,
  });
  expect(() => provider.read("issue", { number: "0" })).toThrow(/Укажите номер issue/);
  expect(() => provider.read("issue", { number: "nope" })).toThrow(/Укажите номер issue/);
  expect(() => provider.read("pulls", {})).toThrow(/недоступно/);
});

test("the shared snapshot provider pins history to the commit", async () => {
  const calls = [];
  const git = snapshotGitProvider({
    repository: "octo/repo",
    snapshot: () => ({ branch: "main", commit: "c".repeat(40) }),
    readGit: async (action, params) => {
      calls.push({ action, params });
      return { action };
    },
  });
  expect(await git.read("git", {})).toStrictEqual({
    available: true,
    branch: "main",
    changes: [],
  });
  expect(await git.read("gutter", { path: "src/main.ts" })).toStrictEqual({
    available: false,
    original: "",
  });
  expect(await git.read("log", { limit: "5" })).toStrictEqual({ action: "log" });
  expect(calls).toStrictEqual([
    {
      action: "log",
      params: { limit: "5", repository: "octo/repo", sha: "c".repeat(40) },
    },
  ]);
  await expect(git.read("diff", { path: "a" })).rejects.toThrow(/недоступно/);
});

test("read-only helpers build a snapshot tree, its files and a connection profile", async () => {
  const page = snapshotTreePage(
    [
      { name: "src", type: "tree", mode: "040000" },
      { name: "run.sh", type: "blob", mode: "100755" },
      { name: "module", type: "commit", mode: "160000" },
    ],
    "docs",
    { limit: "2" },
  );
  expect(page.entries.map((entry) => entry.path)).toStrictEqual(["docs/src", "docs/run.sh"]);
  expect(page.entries[0]).toStrictEqual({
    name: "src",
    path: "docs/src",
    directory: true,
    executable: false,
    disabled: false,
  });
  expect(page.entries[1].executable).toBe(true);
  expect(page.total).toBe(3);
  expect(page.truncated).toBe(true);
  expect(page.nextOffset).toBe(2);

  expect(
    readonlyFileContent("logo.svg", { content: "<svg/>", binary: false, size: 5, image: "data:" }),
  ).toStrictEqual({
    path: "logo.svg",
    content: "<svg/>",
    binary: false,
    size: 5,
    readonly: true,
    image: false,
  });
  expect(readonlyFileContent("logo.png", { content: "", image: "data:" }).image).toBe(true);

  const files = connectionFilesProvider(() => "gh:/octo/repo", "Подключите GitHub");
  expect(await files.read("root", {})).toStrictEqual({ root: "gh:/octo/repo" });
  expect(await files.read("tree", {})).toStrictEqual({ entries: [], truncated: false });
  await expect(files.read("file", { path: "README.md" })).rejects.toThrow(/Подключите GitHub/);
  expect(readonlyWorkspaceFeatures).toStrictEqual({
    terminals: false,
    docker: false,
    agent: false,
    settings: false,
    persist: false,
    externalFiles: false,
  });
});
