import type { LaunchAction, LaunchItem } from "@projector/core/modules/launcher/index.ts";
import { githubProjectRoute } from "@projector/core/modules/github/index.ts";
import { gitlabProjectRoute } from "@projector/core/modules/gitlab/index.ts";
import { searchGithubRepositories } from "../github/index.ts";
import { searchGitlabProjects } from "../gitlab/index.ts";

interface HostedHit {
  fullName: string;
  description: string;
  private: boolean;
  /** GitLab instance of the hit; GitHub results have no instance and keep `gh:<fullName>`. */
  instance?: string;
}

interface HostedSource {
  prefix: "gh" | "gl";
  kind: "github" | "gitlab";
  noun: string;
  action: LaunchAction;
  route: (repo: HostedHit) => string | undefined;
  find: (query: string) => Promise<HostedHit[]>;
}

/** Search results of a code host (`gh:` / `gl:`); every host differs only in id prefix and wording. */
async function searchHosted(
  host: HostedSource,
  query: string,
): Promise<{ items: LaunchItem[]; warning?: string }> {
  try {
    const hits = await host.find(query);
    return {
      items: hits.map((repo): LaunchItem => ({
        id: `${host.prefix}:${repo.instance ? `${repo.instance}/` : ""}${repo.fullName}`,
        name: repo.fullName,
        kind: host.kind,
        description: `${repo.private ? "приватный · " : ""}${repo.description || host.noun}`,
        route: host.route(repo),
        keywords: "",
        actions: [host.action],
      })),
      warning: hits.length ? undefined : "Ничего не найдено",
    };
  } catch (error) {
    return { items: [], warning: error instanceof Error ? error.message : "Сервис недоступен" };
  }
}

const GITHUB: HostedSource = {
  prefix: "gh",
  kind: "github",
  noun: "репозиторий GitHub",
  action: { id: "open", title: "Открыть репозиторий" },
  route: (repo) => githubProjectRoute(repo.fullName),
  find: searchGithubRepositories,
};
const GITLAB: HostedSource = {
  prefix: "gl",
  kind: "gitlab",
  noun: "проект GitLab",
  action: { id: "open", title: "Открыть проект GitLab" },
  route: (repo) => (repo.instance ? gitlabProjectRoute(repo.instance, repo.fullName) : undefined),
  find: searchGitlabProjects,
};

export const searchGithub = (query: string) => searchHosted(GITHUB, query);
export const searchGitlab = (query: string) => searchHosted(GITLAB, query);
