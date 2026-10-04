import { listIntegrations } from "../../../modules/integrations/index.ts";
import {
  configureGithub,
  revealGithubToken,
  connectGithub,
  disconnectGithub,
  beginGithubLogin,
  pollGithubLogin,
  githubRepositories,
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
} from "../../../modules/integrations/index.ts";

import { isLocalRequest } from "../../../modules/access/index.ts";
import { HttpError } from "../../../modules/http/index.ts";
import { json, readBody } from "../../../modules/transport/index.ts";

import { withRuntime } from "../../../modules/project-presentation/index.ts";
import type { RouteContext } from "../../../modules/transport/index.ts";

export async function handleIntegrationsActions({
  req,
  res,
  url,
  method,
  path,
}: RouteContext): Promise<boolean> {
  if (path.startsWith("/api/integrations")) {
    res.setHeader("Cache-Control", "no-store");
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
      else return false;
      return true;
    }
    if (path === "/api/integrations" && method === "GET") {
      json(res, 200, await listIntegrations());
      return true;
    }
    if (path === "/api/integrations/github" && method === "PUT") {
      json(res, 200, await configureGithub(await readBody(req)));
      return true;
    }
    if (path === "/api/integrations/github/auth" && method === "POST") {
      json(res, 200, await connectGithub(await readBody(req)));
      return true;
    }
    if (path === "/api/integrations/github/token" && method === "POST") {
      // Secrets are shown only on this machine, never over LAN and never to the agent.
      if (!isLocalRequest(req))
        throw new HttpError(403, "Токен можно показать только на локальной машине");
      json(res, 200, await revealGithubToken());
      return true;
    }
    if (path === "/api/integrations/github/auth" && method === "DELETE") {
      json(res, 200, await disconnectGithub());
      return true;
    }
    if (path === "/api/integrations/github/device" && method === "POST") {
      json(res, 200, await beginGithubLogin());
      return true;
    }
    if (path === "/api/integrations/github/device/poll" && method === "POST") {
      json(res, 200, await pollGithubLogin(await readBody(req)));
      return true;
    }
    if (path === "/api/integrations/github/repositories" && method === "GET") {
      json(res, 200, await githubRepositories(Number(url.searchParams.get("page") ?? 1)));
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
