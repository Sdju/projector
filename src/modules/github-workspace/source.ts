import type { GithubRepository, GithubEntry } from "../../../core/modules/github/index.ts";
import type { FileContent, FileEntry } from "../../../core/modules/workspace/index.ts";
import { treePageRange } from "../../../core/modules/workspace/index.ts";
import {
  createLocalWorkspaceProfile,
  defineTab,
  singletonTab,
  type WorkspaceProfile,
} from "../workspace-api/index.ts";
import { formatProjectRef } from "../project/index.ts";
import {
  readIssue,
  readDiscussion,
  readDiscussions,
  readIssues,
  readPull,
  readPulls,
  readRepository,
  readTree,
  readFile,
  readGit,
} from "./client.ts";

const connectionTab = singletonTab(
  "github-integration",
  "github:integration",
  "GitHub",
  "Подключение к GitHub",
);

/** Authentication has its own empty workspace and never falls back to local files. */
export function createGithubConnectionProfile(repository: string): WorkspaceProfile {
  return {
    id: "github-connection",
    layout: "editor",
    tabs: [connectionTab],
    features: {
      terminals: false,
      docker: false,
      agent: false,
      settings: false,
      persist: false,
      externalFiles: false,
    },
    providers: {
      files: {
        assetUrl: () => "",
        async read(action) {
          if (action === "root") return { root: formatProjectRef({ kind: "github", repository }) };
          if (action === "tree") return { entries: [], truncated: false };
          throw new Error("Подключите GitHub, чтобы открыть файлы");
        },
      },
    },
  };
}

const UNAVAILABLE = "Действие недоступно для этого источника workspace";

const numberedTab = (id: string, label: string) =>
  defineTab<{ number: number; title?: string }>({
    id,
    key: ({ number }) => `${id}:${number}`,
    path: ({ number }) => `${label} #${number}`,
    title: ({ number, title }) => `${title ? `${title} · ` : ""}${label} #${number}`,
    hint: ({ title }) => title ?? "",
    preview: true,
  });
const issueTab = numberedTab("issue", "Issue");
const pullTab = numberedTab("pull", "PR");
const discussionTab = numberedTab("discussion", "Discussion");

/** Read provider for a numbered resource (issues, pull requests): a list action and a single-item one. */
function numberedProvider(
  listAction: string,
  itemAction: string,
  noun: string,
  repository: string,
  list: (
    repository: string,
    params: Record<string, string>,
    signal?: AbortSignal,
  ) => Promise<unknown>,
  item: (repository: string, number: number, signal?: AbortSignal) => Promise<unknown>,
) {
  return {
    read(action: string, params: Record<string, string>, signal?: AbortSignal) {
      if (action === listAction) return list(repository, params, signal);
      if (action === itemAction) {
        const number = Number(params.number);
        if (!Number.isInteger(number) || number <= 0) throw new Error(`Укажите номер ${noun}`);
        return item(repository, number, signal);
      }
      throw new Error(UNAVAILABLE);
    },
  };
}

/**
 * Local project whose `origin` points at GitHub: files, Git and search stay local (the tree and
 * editing are unchanged); GitHub adds issues and the repository info tab.
 */
export function createGithubEnabledLocalProfile(
  projectId: string,
  repository: string,
): WorkspaceProfile {
  const local = createLocalWorkspaceProfile(projectId);
  const issues = numberedProvider("issues", "issue", "issue", repository, readIssues, readIssue);
  const pulls = numberedProvider("pulls", "pull", "pull request", repository, readPulls, readPull);
  const discussions = numberedProvider(
    "discussions",
    "discussion",
    "обсуждения",
    repository,
    readDiscussions,
    readDiscussion,
  );
  return {
    ...local,
    id: "local-github",
    sidebar: [
      ...(local.sidebar ?? []),
      { id: "issues", title: "Issues" },
      { id: "pulls", title: "Pull requests" },
      { id: "discussions", title: "Discussions" },
    ],
    tabs: [
      ...(local.tabs ?? []),
      singletonTab(
        "repository",
        "github:repository",
        "О репозитории",
        "Информация о репозитории GitHub",
      ),
      issueTab,
      pullTab,
      discussionTab,
    ],
    providers: { ...local.providers, issues, pulls, discussions },
  };
}

/** GitHub adapts to the same provider contracts as a local workspace; it owns no UI. */
export function createGithubWorkspaceProfile(
  repository: string,
  initial: GithubRepository,
  ref: string,
  changed: (metadata: GithubRepository) => void,
  api: {
    readRepository: typeof readRepository;
    readTree: typeof readTree;
    readFile: typeof readFile;
    readGit?: typeof readGit;
    readIssues?: typeof readIssues;
    readIssue?: typeof readIssue;
    readPulls?: typeof readPulls;
    readPull?: typeof readPull;
    readDiscussions?: typeof readDiscussions;
    readDiscussion?: typeof readDiscussion;
  } = {
    readRepository,
    readTree,
    readFile,
    readGit,
    readIssues,
    readIssue,
    readPulls,
    readPull,
    readDiscussions,
    readDiscussion,
  },
): WorkspaceProfile {
  let metadata = initial;
  const directories = new Map<string, Promise<GithubEntry[]>>();
  async function directory(
    snapshot: GithubRepository,
    path: string,
    signal?: AbortSignal,
  ): Promise<GithubEntry[]> {
    if (snapshot.empty) return [];
    if (path && path.split("/").some((part) => !part || part === "." || part === ".."))
      throw new Error("Неверный путь папки");
    const key = `${snapshot.tree}:${path}`;
    const cached = directories.get(key);
    if (cached) return cached;
    const pending = (async () => {
      let sha = snapshot.tree;
      if (path) {
        const parts = path.split("/");
        const parent = parts.slice(0, -1).join("/");
        const entry = (await directory(snapshot, parent, signal)).find(
          (entry) => entry.name === parts.at(-1),
        );
        if (entry?.type !== "tree") throw new Error("Папка не найдена");
        sha = entry.sha;
      }
      const data = await api.readTree(repository, sha, signal);
      if (data.truncated) throw new Error("GitHub вернул неполный список этой папки");
      return data.entries;
    })();
    directories.set(key, pending);
    try {
      return await pending;
    } catch (error) {
      directories.delete(key);
      throw error;
    }
  }
  const git: WorkspaceProfile["providers"]["git"] = {
    allBranches: false,
    async read(action, params, signal) {
      const snapshot = metadata;
      if (action === "git") return { available: true, branch: snapshot.branch, changes: [] };
      if (action === "gutter") return { available: false, original: "" };
      if (!["log", "commit", "commit-diff"].includes(action)) throw new Error(UNAVAILABLE);
      return (api.readGit ?? readGit)(
        action,
        { ...params, repository, sha: snapshot.commit },
        signal,
      );
    },
  };
  const files: WorkspaceProfile["providers"]["files"] = {
    async refresh() {
      const next = await api.readRepository(repository, ref);
      directories.clear();
      metadata = next;
      changed(next);
    },
    assetUrl(path) {
      return `/api/integrations/github/browse/asset?${new URLSearchParams({ repository, sha: metadata.tree, path })}`;
    },
    async read(action, params, signal) {
      const snapshot = metadata;
      const path = params.path || "";
      if (action === "root")
        return { root: formatProjectRef({ kind: "github", repository: snapshot.fullName }) };
      if (action === "tree") {
        const entries: FileEntry[] = (await directory(snapshot, path, signal)).map((entry) => ({
          name: entry.name,
          path: path ? `${path}/${entry.name}` : entry.name,
          directory: entry.type === "tree",
          executable: entry.mode === "100755",
          disabled: entry.type === "commit",
        }));
        const page = treePageRange(entries, path, params);
        return {
          entries: entries.slice(page.offset, page.end),
          truncated: page.nextOffset !== null,
          total: page.total,
          nextOffset: page.nextOffset,
        };
      }
      if (action !== "file") throw new Error(UNAVAILABLE);
      if (
        !path ||
        path.includes("\\") ||
        path.includes("\0") ||
        path.split("/").some((part) => !part || part === "." || part === "..")
      )
        throw new Error("Неверный путь файла");
      const parts = path.split("/");
      const entry = (await directory(snapshot, parts.slice(0, -1).join("/"), signal)).find(
        (entry) => entry.name === parts.at(-1),
      );
      if (entry?.type !== "blob") throw new Error("Файл не найден");
      if (entry.size > 5 * 1024 * 1024)
        throw new Error("Просмотр файлов больше 5 MiB пока недоступен");
      const file = await api.readFile(repository, entry.sha, path, signal);
      const content: FileContent & { image: boolean } = {
        path,
        content: file.content,
        binary: file.binary,
        size: file.size,
        readonly: true,
        image: !!file.image && !/\.svg$/i.test(path),
      };
      return content;
    },
  };
  const issues = numberedProvider(
    "issues",
    "issue",
    "issue",
    repository,
    api.readIssues ?? readIssues,
    api.readIssue ?? readIssue,
  );
  const pulls = numberedProvider(
    "pulls",
    "pull",
    "pull request",
    repository,
    api.readPulls ?? readPulls,
    api.readPull ?? readPull,
  );
  const discussions = numberedProvider(
    "discussions",
    "discussion",
    "обсуждения",
    repository,
    api.readDiscussions ?? readDiscussions,
    api.readDiscussion ?? readDiscussion,
  );
  return {
    id: "github",
    layout: "editor",
    sidebar: [
      { id: "issues", title: "Issues" },
      { id: "pulls", title: "Pull requests" },
      { id: "discussions", title: "Discussions" },
    ],
    tabs: [
      connectionTab,
      singletonTab(
        "repository",
        "github:repository",
        "О репозитории",
        "Информация о репозитории GitHub",
      ),
      issueTab,
      pullTab,
      discussionTab,
    ],
    features: {
      terminals: false,
      docker: false,
      agent: false,
      settings: false,
      persist: false,
      externalFiles: false,
    },
    providers: { files, git, issues, pulls, discussions },
  };
}
