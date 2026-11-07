import { listIntegrations } from "../../../modules/integration-store/index.ts";
import { dockerIntegrationStatus } from "../../../modules/docker/index.ts";
import { startCloneJob, cloneJob, cancelCloneJob } from "../../../modules/git-import/index.ts";
import {
  configureGithub,
  revealGithubToken,
  connectGithub,
  disconnectGithub,
  beginGithubLogin,
  pollGithubLogin,
  githubRepositories,
  githubStatus,
  githubEmojis,
  importGithubProject,
  cloneGithubProject,
} from "../../../modules/github/index.ts";
import {
  configureGitlab,
  connectGitlab,
  disconnectGitlab,
  revealGitlabToken,
  beginGitlabLogin,
  pollGitlabLogin,
  gitlabRepositories,
  gitlabStatus,
  importGitlabProject,
  cloneGitlabProject,
  browseGitlabRepository,
  browseGitlabDirectories,
  browseGitlabTree,
  browseGitlabFile,
  browseGitlabAsset,
  browseGitlabIcon,
  browseGitlabLog,
  browseGitlabCommit,
  browseGitlabComparison,
  browseGitlabCompareChanges,
  browseGitlabCompareFile,
  browseGitlabIssues,
  browseGitlabIssue,
  browseGitlabMergeRequests,
  browseGitlabMergeRequest,
  browseGitlabMergeRequestFiles,
  browseGitlabMergeRequestDiff,
  browseGitlabPipelines,
  browseGitlabPipeline,
  browseGitlabJob,
  searchGitlabBlobs,
} from "../../../modules/gitlab/index.ts";

import { isLocalRequest } from "../../../modules/access/index.ts";
import { HttpError } from "../../../modules/http/index.ts";
import {
  json,
  readBody,
  type RouteDefinition,
  type RouteHandler,
} from "../../../modules/transport/index.ts";

import { sendIconBytes, withRuntime } from "../../../modules/project-presentation/index.ts";
import { letterIconSvg } from "../../../modules/projects/index.ts";

type HostActions = {
  configure: (body: Record<string, unknown>) => Promise<unknown>;
  connect: (body: Record<string, unknown>) => Promise<unknown>;
  disconnect: () => Promise<unknown>;
  reveal: () => Promise<unknown>;
  repositories: (page: number) => Promise<unknown>;
};

const hosts: Record<"github" | "gitlab", HostActions> = {
  github: {
    configure: configureGithub,
    connect: connectGithub,
    disconnect: disconnectGithub,
    reveal: revealGithubToken,
    repositories: githubRepositories,
  },
  gitlab: {
    configure: configureGitlab,
    connect: connectGitlab,
    disconnect: disconnectGitlab,
    reveal: revealGitlabToken,
    repositories: gitlabRepositories,
  },
};

const text = (url: URL, key: string) => url.searchParams.get(key) || "";

function endpoint(
  method: string | readonly string[],
  path: string,
  handler: RouteHandler,
): RouteDefinition {
  return {
    method,
    path,
    handler: (context) => {
      context.res.setHeader("Cache-Control", "no-store");
      return handler(context);
    },
  };
}

function hostRoutes(hostName: keyof typeof hosts): RouteDefinition[] {
  const host = hosts[hostName];
  const base = `/api/integrations/${hostName}`;
  return [
    endpoint("PUT", base, async ({ req, res }) => {
      json(res, 200, await host.configure(await readBody(req)));
    }),
    endpoint("POST", `${base}/auth`, async ({ req, res }) => {
      json(res, 200, await host.connect(await readBody(req)));
    }),
    endpoint("DELETE", `${base}/auth`, async ({ res }) => {
      json(res, 200, await host.disconnect());
    }),
    endpoint("POST", `${base}/token`, async ({ req, res }) => {
      // Secrets are shown only on this machine, never over LAN and never to the agent.
      if (!isLocalRequest(req))
        throw new HttpError(403, "Токен можно показать только на локальной машине");
      json(res, 200, await host.reveal());
    }),
    endpoint("GET", `${base}/repositories`, async ({ res, url }) => {
      json(res, 200, await host.repositories(Number(url.searchParams.get("page") ?? 1)));
    }),
  ];
}

function jobRoutes(hostName: "github" | "gitlab"): RouteDefinition[] {
  const path = `/api/integrations/${hostName}/clone-jobs/:id([0-9a-f-]{36})`;
  return [
    endpoint("GET", path, async ({ res, params }) => {
      const job = cloneJob(params.id);
      json(res, 200, { job: job.project ? { ...job, project: withRuntime(job.project) } : job });
    }),
    endpoint("DELETE", path, async ({ res, params }) => {
      json(res, 200, { job: cancelCloneJob(params.id) });
    }),
  ];
}

export const routes: RouteDefinition[] = [
  endpoint("GET", "/api/integrations", async ({ res }) => {
    json(res, 200, await listIntegrations([githubStatus, gitlabStatus, dockerIntegrationStatus]));
  }),
  endpoint("GET", "/api/integrations/github/emojis", async ({ res }) => {
    res.setHeader("Cache-Control", "private, max-age=3600");
    json(res, 200, await githubEmojis());
  }),

  ...hostRoutes("github"),
  ...hostRoutes("gitlab"),

  // GitLab browsing is registered explicitly so `/browse/...` never falls through to host actions.
  endpoint("GET", "/api/integrations/gitlab/browse/directories", async ({ res, url }) => {
    json(
      res,
      200,
      await browseGitlabDirectories(text(url, "path"), url.searchParams.get("complete") === "true"),
    );
  }),
  endpoint("GET", "/api/integrations/gitlab/browse/icon", async ({ res, url }) => {
    const repository = text(url, "repository");
    const icon = await browseGitlabIcon(repository, text(url, "ref") || text(url, "sha")).catch(
      () => null,
    );
    sendIconBytes(
      res,
      icon?.mime ?? "image/svg+xml",
      icon?.bytes ??
        Buffer.from(letterIconSvg(repository.split("/").filter(Boolean).at(-1) || "GitLab")),
    );
  }),
  endpoint("GET", "/api/integrations/gitlab/browse/asset", async ({ res, url }) => {
    const asset = await browseGitlabAsset(
      text(url, "repository"),
      text(url, "sha"),
      text(url, "path"),
    );
    res.setHeader("Content-Type", asset.mime);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
    res.end(asset.bytes);
  }),
  endpoint("GET", "/api/integrations/gitlab/browse/repository", async ({ res, url }) => {
    json(res, 200, await browseGitlabRepository(text(url, "repository"), text(url, "ref")));
  }),
  endpoint("GET", "/api/integrations/gitlab/browse/tree", async ({ res, url }) => {
    json(
      res,
      200,
      await browseGitlabTree(text(url, "repository"), text(url, "sha"), text(url, "path")),
    );
  }),
  endpoint("GET", "/api/integrations/gitlab/browse/file", async ({ res, url }) => {
    json(
      res,
      200,
      await browseGitlabFile(text(url, "repository"), text(url, "sha"), text(url, "path")),
    );
  }),
  endpoint("GET", "/api/integrations/gitlab/browse/log", async ({ res, url }) => {
    json(
      res,
      200,
      await browseGitlabLog(text(url, "repository"), Object.fromEntries(url.searchParams)),
    );
  }),
  endpoint("GET", "/api/integrations/gitlab/browse/commit", async ({ res, url }) => {
    json(res, 200, await browseGitlabCommit(text(url, "repository"), text(url, "hash")));
  }),
  endpoint("GET", "/api/integrations/gitlab/browse/commit-diff", async ({ res, url }) => {
    json(
      res,
      200,
      await browseGitlabComparison(text(url, "repository"), text(url, "hash"), text(url, "path")),
    );
  }),
  endpoint("GET", "/api/integrations/gitlab/browse/issues", async ({ res, url }) => {
    json(
      res,
      200,
      await browseGitlabIssues(text(url, "repository"), Object.fromEntries(url.searchParams)),
    );
  }),
  endpoint("GET", "/api/integrations/gitlab/browse/issue", async ({ res, url }) => {
    json(
      res,
      200,
      await browseGitlabIssue(text(url, "repository"), Number(url.searchParams.get("number"))),
    );
  }),
  endpoint("GET", "/api/integrations/gitlab/browse/merge-requests", async ({ res, url }) => {
    json(
      res,
      200,
      await browseGitlabMergeRequests(
        text(url, "repository"),
        Object.fromEntries(url.searchParams),
      ),
    );
  }),
  endpoint("GET", "/api/integrations/gitlab/browse/merge-request", async ({ res, url }) => {
    json(
      res,
      200,
      await browseGitlabMergeRequest(
        text(url, "repository"),
        Number(url.searchParams.get("number")),
      ),
    );
  }),
  endpoint("GET", "/api/integrations/gitlab/browse/merge-request-files", async ({ res, url }) => {
    json(
      res,
      200,
      await browseGitlabMergeRequestFiles(
        text(url, "repository"),
        Number(url.searchParams.get("number")),
      ),
    );
  }),
  endpoint("GET", "/api/integrations/gitlab/browse/compare-changes", async ({ res, url }) => {
    json(
      res,
      200,
      await browseGitlabCompareChanges(text(url, "repository"), text(url, "from"), text(url, "to")),
    );
  }),
  endpoint("GET", "/api/integrations/gitlab/browse/compare-file", async ({ res, url }) => {
    json(
      res,
      200,
      await browseGitlabCompareFile(
        text(url, "repository"),
        text(url, "from"),
        text(url, "to"),
        text(url, "path"),
        url.searchParams.get("originalPath") || undefined,
      ),
    );
  }),
  endpoint("GET", "/api/integrations/gitlab/browse/search", async ({ res, url }) => {
    json(
      res,
      200,
      await searchGitlabBlobs(text(url, "repository"), Object.fromEntries(url.searchParams)),
    );
  }),
  endpoint("GET", "/api/integrations/gitlab/browse/merge-request-diff", async ({ res, url }) => {
    json(
      res,
      200,
      await browseGitlabMergeRequestDiff(
        text(url, "repository"),
        Number(url.searchParams.get("number")),
        text(url, "path"),
      ),
    );
  }),
  endpoint("GET", "/api/integrations/gitlab/browse/pipelines", async ({ res, url }) => {
    json(
      res,
      200,
      await browseGitlabPipelines(text(url, "repository"), Object.fromEntries(url.searchParams)),
    );
  }),
  endpoint("GET", "/api/integrations/gitlab/browse/pipeline", async ({ res, url }) => {
    json(res, 200, await browseGitlabPipeline(text(url, "repository"), text(url, "id")));
  }),
  endpoint("GET", "/api/integrations/gitlab/browse/job", async ({ res, url }) => {
    json(res, 200, await browseGitlabJob(text(url, "repository"), text(url, "id")));
  }),

  endpoint("POST", "/api/integrations/github/device", async ({ res }) => {
    json(res, 200, await beginGithubLogin());
  }),
  endpoint("POST", "/api/integrations/github/device/poll", async ({ req, res }) => {
    json(res, 200, await pollGithubLogin(await readBody(req)));
  }),
  endpoint("POST", "/api/integrations/gitlab/device", async ({ res }) => {
    json(res, 200, await beginGitlabLogin());
  }),
  endpoint("POST", "/api/integrations/gitlab/device/poll", async ({ req, res }) => {
    json(res, 200, await pollGitlabLogin(await readBody(req)));
  }),

  endpoint("POST", "/api/integrations/gitlab/import", async ({ req, res }) => {
    const result = await importGitlabProject(await readBody(req));
    json(res, 201, { project: withRuntime(result.project) });
  }),
  endpoint("POST", "/api/integrations/gitlab/clone", async ({ req, res }) => {
    const result = await cloneGitlabProject(await readBody(req));
    json(res, 201, { project: withRuntime(result.project) });
  }),
  endpoint("POST", "/api/integrations/gitlab/clone-jobs", async ({ req, res }) => {
    json(res, 202, { job: startCloneJob(await readBody(req), cloneGitlabProject) });
  }),
  ...jobRoutes("gitlab"),

  endpoint("POST", "/api/integrations/github/clone-jobs", async ({ req, res }) => {
    json(res, 202, { job: startCloneJob(await readBody(req), cloneGithubProject) });
  }),
  ...jobRoutes("github"),
  endpoint("POST", "/api/integrations/github/clone", async ({ req, res }) => {
    const result = await cloneGithubProject(await readBody(req));
    json(res, 201, { project: withRuntime(result.project) });
  }),
  endpoint("POST", "/api/integrations/github/import", async ({ req, res }) => {
    const result = await importGithubProject(await readBody(req));
    json(res, 201, { project: withRuntime(result.project) });
  }),
];
