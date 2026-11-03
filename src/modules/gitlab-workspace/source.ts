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
  readJob,
  readMergeRequest,
  readMergeRequestDiff,
  readMergeRequestFiles,
  readMergeRequests,
  readPipeline,
  readPipelines,
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

const idTab = (kind: string, label: string) =>
  defineTab<{ id: number; title?: string }>({
    id: kind,
    key: ({ id }) => `${kind}:${id}`,
    path: ({ id }) => `${label} #${id}`,
    title: ({ id, title }) => `${title ? `${title} · ` : ""}${label} #${id}`,
    hint: ({ title }) => title ?? "",
    preview: true,
  });
const pipelineTab = idTab("pipeline", "Pipeline");
const jobTab = idTab("job", "Job");

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

/** Merge requests add changed-file reads to the numbered resource contract. */
function mergeRequestProvider(repository: string, api: GitlabWorkspaceApi = defaultApi) {
  const base = numberedProvider(
    "pulls",
    "pull",
    "merge request",
    repository,
    api.readMergeRequests ?? readMergeRequests,
    api.readMergeRequest ?? readMergeRequest,
  );
  return {
    read(action: string, params: Record<string, string>, signal?: AbortSignal) {
      if (action !== "pull-files" && action !== "pull-diff")
        return base.read(action, params, signal);
      const number = Number(params.number);
      if (!Number.isInteger(number) || number <= 0) throw new Error("Укажите номер merge request");
      if (action === "pull-files")
        return (api.readMergeRequestFiles ?? readMergeRequestFiles)(repository, number, signal);
      const path = params.path || "";
      if (!path) throw new Error("Укажите путь файла merge request");
      return (api.readMergeRequestDiff ?? readMergeRequestDiff)(repository, number, path, signal);
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
  readMergeRequestFiles?: typeof readMergeRequestFiles;
  readMergeRequestDiff?: typeof readMergeRequestDiff;
  readPipelines?: typeof readPipelines;
  readPipeline?: typeof readPipeline;
  readJob?: typeof readJob;
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
  readMergeRequestFiles,
  readMergeRequestDiff,
  readPipelines,
  readPipeline,
  readJob,
};

/** Pipelines, a pipeline with its jobs, and one job with its trace. */
function pipelineProvider(
  repository: string,
  api: GitlabWorkspaceApi = defaultApi,
): {
  read(action: string, params: Record<string, string>, signal?: AbortSignal): Promise<unknown>;
} {
  return {
    read(action, params, signal) {
      if (action === "pipelines")
        return (api.readPipelines ?? readPipelines)(repository, params, signal);
      if (action !== "pipeline" && action !== "job") throw new Error(UNAVAILABLE);
      const id = Number(params.id);
      if (!Number.isSafeInteger(id) || id <= 0) throw new Error("Укажите номер записи CI");
      if (action === "pipeline") return (api.readPipeline ?? readPipeline)(repository, id, signal);
      return (api.readJob ?? readJob)(repository, id, signal);
    },
  };
}

/**
 * Local project whose `origin` points at GitLab: files, Git and search stay local; GitLab adds
 * issues, merge requests, pipelines and the project info tab.
 */
export function createGitlabEnabledLocalProfile(
  projectId: string,
  instance: string,
  path: string,
): WorkspaceProfile {
  const repository = `${instance}/${path}`;
  const local = createLocalWorkspaceProfile(projectId);
  const issues = numberedProvider("issues", "issue", "issue", repository, readIssues, readIssue);
  const pulls = mergeRequestProvider(repository);
  return {
    ...local,
    id: "local-gitlab",
    sidebar: [
      ...(local.sidebar ?? []),
      { id: "issues", title: "Issues" },
      { id: "merge-requests", title: "Merge requests" },
      { id: "pipelines", title: "Pipelines", requires: "pipelines" },
    ],
    tabs: [...(local.tabs ?? []), repositoryTab, issueTab, pullTab, pipelineTab, jobTab],
    providers: { ...local.providers, issues, pulls, pipelines: pipelineProvider(repository) },
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
  const pulls = mergeRequestProvider(repository, api);
  return {
    id: "gitlab",
    layout: "editor",
    sidebar: [
      { id: "issues", title: "Issues" },
      { id: "merge-requests", title: "Merge requests" },
      { id: "pipelines", title: "Pipelines", requires: "pipelines" },
    ],
    tabs: [integrationTab, repositoryTab, issueTab, pullTab, pipelineTab, jobTab],
    features: {
      terminals: false,
      docker: false,
      agent: false,
      settings: false,
      persist: false,
      externalFiles: false,
    },
    providers: {
      files,
      git,
      issues,
      pulls,
      pipelines: pipelineProvider(repository, api),
    },
  };
}
