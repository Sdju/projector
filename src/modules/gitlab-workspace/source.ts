import type { GitlabEntry, GitlabRepository } from "../../../core/modules/gitlab/index.ts";
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
  readFile,
  readGit,
  readIssue,
  readIssues,
  readMergeRequest,
  readMergeRequests,
  readRepository,
  readTree,
} from "./client.ts";

const integrationTab = singletonTab(
  "gitlab-integration",
  "gitlab:integration",
  "GitLab",
  "Подключение к GitLab",
);

/** Authentication has its own empty workspace and never falls back to local files. */
export function createGitlabConnectionProfile(instance: string, path: string): WorkspaceProfile {
  return {
    id: "gitlab-connection",
    layout: "editor",
    tabs: [integrationTab],
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
          if (action === "root")
            return { root: formatProjectRef({ kind: "gitlab", instance, path }) };
          if (action === "tree") return { entries: [], truncated: false };
          throw new Error("Подключите GitLab, чтобы открыть файлы");
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
const pullTab = numberedTab("pull", "MR");

const repositoryTab = singletonTab(
  "repository",
  "gitlab:repository",
  "О проекте",
  "Информация о проекте GitLab",
);

/** Read provider for a numbered resource (issues, merge requests): a list and a single-item action. */
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

export interface GitlabWorkspaceApi {
  readRepository: typeof readRepository;
  readTree: typeof readTree;
  readFile: typeof readFile;
  readGit?: typeof readGit;
  readIssues?: typeof readIssues;
  readIssue?: typeof readIssue;
  readMergeRequests?: typeof readMergeRequests;
  readMergeRequest?: typeof readMergeRequest;
}

const defaultApi: GitlabWorkspaceApi = {
  readRepository,
  readTree,
  readFile,
  readGit,
  readIssues,
  readIssue,
  readMergeRequests,
  readMergeRequest,
};

/**
 * Local project whose `origin` points at GitLab: files, Git and search stay local; GitLab adds
 * issues, merge requests and the project info tab.
 */
export function createGitlabEnabledLocalProfile(
  projectId: string,
  instance: string,
  path: string,
): WorkspaceProfile {
  const repository = `${instance}/${path}`;
  const local = createLocalWorkspaceProfile(projectId);
  const issues = numberedProvider("issues", "issue", "issue", repository, readIssues, readIssue);
  const pulls = numberedProvider(
    "pulls",
    "pull",
    "merge request",
    repository,
    readMergeRequests,
    readMergeRequest,
  );
  return {
    ...local,
    id: "local-gitlab",
    sidebar: [
      ...(local.sidebar ?? []),
      { id: "issues", title: "Issues" },
      { id: "merge-requests", title: "Merge requests" },
    ],
    tabs: [...(local.tabs ?? []), repositoryTab, issueTab, pullTab],
    providers: { ...local.providers, issues, pulls },
  };
}

/**
 * GitLab adapts to the same provider contracts as a local workspace; it owns no UI. The snapshot
 * is pinned to a commit, so tree and file reads never walk the repository hierarchy themselves.
 */
export function createGitlabWorkspaceProfile(
  repository: string,
  instance: string,
  path: string,
  initial: GitlabRepository,
  ref: string,
  changed: (metadata: GitlabRepository) => void,
  api: GitlabWorkspaceApi = defaultApi,
): WorkspaceProfile {
  let metadata = initial;
  const directories = new Map<string, Promise<GitlabEntry[]>>();
  async function directory(
    snapshot: GitlabRepository,
    folder: string,
    signal?: AbortSignal,
  ): Promise<GitlabEntry[]> {
    if (snapshot.empty) return [];
    if (folder && folder.split("/").some((part) => !part || part === "." || part === ".."))
      throw new Error("Неверный путь папки");
    const key = `${snapshot.commit}:${folder}`;
    const cached = directories.get(key);
    if (cached) return cached;
    const pending = (async () => {
      const data = await api.readTree(repository, snapshot.commit, folder, signal);
      if (data.truncated) throw new Error("GitLab вернул неполный список этой папки");
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
    assetUrl(file) {
      return `/api/integrations/gitlab/browse/asset?${new URLSearchParams({
        repository,
        sha: metadata.commit,
        path: file,
      })}`;
    },
    async read(action, params, signal) {
      const snapshot = metadata;
      const folder = params.path || "";
      if (action === "root") return { root: formatProjectRef({ kind: "gitlab", instance, path }) };
      if (action === "tree") {
        const entries: FileEntry[] = (await directory(snapshot, folder, signal)).map((entry) => ({
          name: entry.name,
          path: folder ? `${folder}/${entry.name}` : entry.name,
          directory: entry.type === "tree",
          executable: entry.mode === "100755",
          disabled: entry.type === "commit",
        }));
        const page = treePageRange(entries, folder, params);
        return {
          entries: entries.slice(page.offset, page.end),
          truncated: page.nextOffset !== null,
          total: page.total,
          nextOffset: page.nextOffset,
        };
      }
      if (action !== "file") throw new Error(UNAVAILABLE);
      if (
        !folder ||
        folder.includes("\\") ||
        folder.includes("\0") ||
        folder.split("/").some((part) => !part || part === "." || part === "..")
      )
        throw new Error("Неверный путь файла");
      const file = await api.readFile(repository, snapshot.commit, folder, signal);
      const content: FileContent & { image: boolean } = {
        path: folder,
        content: file.content,
        binary: file.binary,
        size: file.size,
        readonly: true,
        image: !!file.image && !/\.svg$/i.test(folder),
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
    "merge request",
    repository,
    api.readMergeRequests ?? readMergeRequests,
    api.readMergeRequest ?? readMergeRequest,
  );
  return {
    id: "gitlab",
    layout: "editor",
    sidebar: [
      { id: "issues", title: "Issues" },
      { id: "merge-requests", title: "Merge requests" },
    ],
    tabs: [integrationTab, repositoryTab, issueTab, pullTab],
    features: {
      terminals: false,
      docker: false,
      agent: false,
      settings: false,
      persist: false,
      externalFiles: false,
    },
    providers: { files, git, issues, pulls },
  };
}
