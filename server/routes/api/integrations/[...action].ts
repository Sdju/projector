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
  importGithubProject,
  cloneGithubProject,
  browseGithubRepository,
  browseGithubDirectories,
  browseGithubTree,
  browseGithubFile,
  browseGithubAsset,
  browseGithubLog,
  browseGithubCommit,
  browseGithubComparison,
  browseGithubIssues,
  browseGithubIssue,
  browseGithubPulls,
  githubEmojis,
  browseGithubDiscussions,
  browseGithubDiscussion,
  browseGithubPull,
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
  browseGitlabLog,
  browseGitlabCommit,
  browseGitlabComparison,
  browseGitlabIssues,
  browseGitlabIssue,
  browseGitlabMergeRequests,
  browseGitlabMergeRequest,
  browseGitlabPipelines,
  browseGitlabPipeline,
  browseGitlabJob,
} from "../../../modules/gitlab/index.ts";

import { isLocalRequest } from "../../../modules/access/index.ts";
import { HttpError } from "../../../modules/http/index.ts";
import { json, readBody } from "../../../modules/transport/index.ts";

import { withRuntime } from "../../../modules/project-presentation/index.ts";
import type { RouteContext } from "../../../modules/transport/index.ts";

const hosts = {
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

export async function handleIntegrationsActions({
  req,
  res,
  url,
  method,
  path,
}: RouteContext): Promise<boolean> {
  if (path.startsWith("/api/integrations")) {
    res.setHeader("Cache-Control", "no-store");
    if (path === "/api/integrations/github/emojis" && method === "GET") {
      res.setHeader("Cache-Control", "private, max-age=3600");
      json(res, 200, await githubEmojis());
      return true;
    }
    if (path.startsWith("/api/integrations/github/browse/") && method === "GET") {
      const repository = url.searchParams.get("repository") || "";
      const sha = url.searchParams.get("sha") || "";
      if (path === "/api/integrations/github/browse/directories")
        json(
          res,
          200,
          await browseGithubDirectories(
            url.searchParams.get("path") || "",
            url.searchParams.get("complete") === "true",
          ),
        );
      else if (path === "/api/integrations/github/browse/asset") {
        const asset = await browseGithubAsset(repository, sha, url.searchParams.get("path") || "");
        res.setHeader("Content-Type", asset.mime);
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
        res.end(asset.bytes);
      } else if (path.endsWith("/repository"))
        json(res, 200, await browseGithubRepository(repository, url.searchParams.get("ref") || ""));
      else if (path.endsWith("/tree")) json(res, 200, await browseGithubTree(repository, sha));
      else if (path.endsWith("/file"))
        json(res, 200, await browseGithubFile(repository, sha, url.searchParams.get("path") || ""));
      else if (path.endsWith("/log"))
        json(res, 200, await browseGithubLog(repository, Object.fromEntries(url.searchParams)));
      else if (path.endsWith("/commit"))
        json(res, 200, await browseGithubCommit(repository, url.searchParams.get("hash") || ""));
      else if (path.endsWith("/commit-diff"))
        json(
          res,
          200,
          await browseGithubComparison(
            repository,
            url.searchParams.get("hash") || "",
            url.searchParams.get("path") || "",
          ),
        );
      else if (path.endsWith("/issues"))
        json(res, 200, await browseGithubIssues(repository, Object.fromEntries(url.searchParams)));
      else if (path.endsWith("/issue"))
        json(res, 200, await browseGithubIssue(repository, Number(url.searchParams.get("number"))));
      else if (path.endsWith("/pulls"))
        json(res, 200, await browseGithubPulls(repository, Object.fromEntries(url.searchParams)));
      else if (path.endsWith("/pull"))
        json(res, 200, await browseGithubPull(repository, Number(url.searchParams.get("number"))));
      else if (path.endsWith("/discussions"))
        json(
          res,
          200,
          await browseGithubDiscussions(repository, Object.fromEntries(url.searchParams)),
        );
      else if (path.endsWith("/discussion"))
        json(
          res,
          200,
          await browseGithubDiscussion(repository, Number(url.searchParams.get("number"))),
        );
      else return false;
      return true;
    }
    // GitLab browsing is checked before hostMatch so `/browse/...` never falls through.
    if (path.startsWith("/api/integrations/gitlab/browse/") && method === "GET") {
      const repository = url.searchParams.get("repository") || "";
      const sha = url.searchParams.get("sha") || "";
      if (path === "/api/integrations/gitlab/browse/directories")
        json(
          res,
          200,
          await browseGitlabDirectories(
            url.searchParams.get("path") || "",
            url.searchParams.get("complete") === "true",
          ),
        );
      else if (path === "/api/integrations/gitlab/browse/asset") {
        const asset = await browseGitlabAsset(repository, sha, url.searchParams.get("path") || "");
        res.setHeader("Content-Type", asset.mime);
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
        res.end(asset.bytes);
      } else if (path === "/api/integrations/gitlab/browse/repository")
        json(res, 200, await browseGitlabRepository(repository, url.searchParams.get("ref") || ""));
      else if (path === "/api/integrations/gitlab/browse/tree")
        json(res, 200, await browseGitlabTree(repository, sha, url.searchParams.get("path") || ""));
      else if (path === "/api/integrations/gitlab/browse/file")
        json(res, 200, await browseGitlabFile(repository, sha, url.searchParams.get("path") || ""));
      else if (path === "/api/integrations/gitlab/browse/log")
        json(res, 200, await browseGitlabLog(repository, Object.fromEntries(url.searchParams)));
      else if (path === "/api/integrations/gitlab/browse/commit")
        json(res, 200, await browseGitlabCommit(repository, url.searchParams.get("hash") || ""));
      else if (path === "/api/integrations/gitlab/browse/commit-diff")
        json(
          res,
          200,
          await browseGitlabComparison(
            repository,
            url.searchParams.get("hash") || "",
            url.searchParams.get("path") || "",
          ),
        );
      else if (path === "/api/integrations/gitlab/browse/issues")
        json(res, 200, await browseGitlabIssues(repository, Object.fromEntries(url.searchParams)));
      else if (path === "/api/integrations/gitlab/browse/issue")
        json(res, 200, await browseGitlabIssue(repository, Number(url.searchParams.get("number"))));
      else if (path === "/api/integrations/gitlab/browse/merge-requests")
        json(
          res,
          200,
          await browseGitlabMergeRequests(repository, Object.fromEntries(url.searchParams)),
        );
      else if (path === "/api/integrations/gitlab/browse/merge-request")
        json(
          res,
          200,
          await browseGitlabMergeRequest(repository, Number(url.searchParams.get("number"))),
        );
      else if (path === "/api/integrations/gitlab/browse/pipelines")
        json(
          res,
          200,
          await browseGitlabPipelines(repository, Object.fromEntries(url.searchParams)),
        );
      else if (path === "/api/integrations/gitlab/browse/pipeline")
        json(res, 200, await browseGitlabPipeline(repository, url.searchParams.get("id") || ""));
      else if (path === "/api/integrations/gitlab/browse/job")
        json(res, 200, await browseGitlabJob(repository, url.searchParams.get("id") || ""));
      else return false;
      return true;
    }
    if (path === "/api/integrations" && method === "GET") {
      json(res, 200, await listIntegrations([githubStatus, gitlabStatus, dockerIntegrationStatus]));
      return true;
    }
    // Settings, token and repository list behave identically for every code host.
    const hostMatch = path.match(
      /^\/api\/integrations\/(github|gitlab)(\/auth|\/token|\/repositories)?$/,
    );
    if (hostMatch) {
      const host = hosts[hostMatch[1] as keyof typeof hosts];
      const action = hostMatch[2] ?? "";
      if (action === "" && method === "PUT") {
        json(res, 200, await host.configure(await readBody(req)));
        return true;
      }
      if (action === "/auth" && method === "POST") {
        json(res, 200, await host.connect(await readBody(req)));
        return true;
      }
      if (action === "/auth" && method === "DELETE") {
        json(res, 200, await host.disconnect());
        return true;
      }
      if (action === "/token" && method === "POST") {
        // Secrets are shown only on this machine, never over LAN and never to the agent.
        if (!isLocalRequest(req))
          throw new HttpError(403, "Токен можно показать только на локальной машине");
        json(res, 200, await host.reveal());
        return true;
      }
      if (action === "/repositories" && method === "GET") {
        json(res, 200, await host.repositories(Number(url.searchParams.get("page") ?? 1)));
        return true;
      }
    }
    if (path === "/api/integrations/github/device" && method === "POST") {
      json(res, 200, await beginGithubLogin());
      return true;
    }
    if (path === "/api/integrations/github/device/poll" && method === "POST") {
      json(res, 200, await pollGithubLogin(await readBody(req)));
      return true;
    }
    if (path === "/api/integrations/gitlab/device" && method === "POST") {
      json(res, 200, await beginGitlabLogin());
      return true;
    }
    if (path === "/api/integrations/gitlab/device/poll" && method === "POST") {
      json(res, 200, await pollGitlabLogin(await readBody(req)));
      return true;
    }
    if (path === "/api/integrations/gitlab/import" && method === "POST") {
      const result = await importGitlabProject(await readBody(req));
      json(res, 201, { project: withRuntime(result.project) });
      return true;
    }
    if (path === "/api/integrations/gitlab/clone" && method === "POST") {
      const result = await cloneGitlabProject(await readBody(req));
      json(res, 201, { project: withRuntime(result.project) });
      return true;
    }
    if (path === "/api/integrations/gitlab/clone-jobs" && method === "POST") {
      json(res, 202, { job: startCloneJob(await readBody(req), cloneGitlabProject) });
      return true;
    }
    const gitlabJobMatch = path.match(/^\/api\/integrations\/gitlab\/clone-jobs\/([0-9a-f-]{36})$/);
    if (gitlabJobMatch && method === "GET") {
      const job = cloneJob(gitlabJobMatch[1]);
      json(res, 200, { job: job.project ? { ...job, project: withRuntime(job.project) } : job });
      return true;
    }
    if (gitlabJobMatch && method === "DELETE") {
      json(res, 200, { job: cancelCloneJob(gitlabJobMatch[1]) });
      return true;
    }
    if (path === "/api/integrations/github/clone-jobs" && method === "POST") {
      json(res, 202, { job: startCloneJob(await readBody(req), cloneGithubProject) });
      return true;
    }
    const jobMatch = path.match(/^\/api\/integrations\/github\/clone-jobs\/([0-9a-f-]{36})$/);
    if (jobMatch && method === "GET") {
      const job = cloneJob(jobMatch[1]);
      json(res, 200, { job: job.project ? { ...job, project: withRuntime(job.project) } : job });
      return true;
    }
    if (jobMatch && method === "DELETE") {
      json(res, 200, { job: cancelCloneJob(jobMatch[1]) });
      return true;
    }
    if (path === "/api/integrations/github/clone" && method === "POST") {
      const result = await cloneGithubProject(await readBody(req));
      json(res, 201, { project: withRuntime(result.project) });
      return true;
    }
    if (path === "/api/integrations/github/import" && method === "POST") {
      const result = await importGithubProject(await readBody(req));
      json(res, 201, { project: withRuntime(result.project) });
      return true;
    }
  }
  return false;
}
