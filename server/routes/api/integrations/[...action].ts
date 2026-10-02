import { listIntegrations } from "../../../modules/integrations/index.ts";
import {
  configureGithub,
  connectGithub,
  disconnectGithub,
  beginGithubLogin,
  pollGithubLogin,
  githubRepositories,
  importGithubProject,
} from "../../../modules/integrations/index.ts";

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
    if (path === "/api/integrations/github/import" && method === "POST") {
      const result = await importGithubProject(await readBody(req));
      json(res, 201, { project: withRuntime(result.project) });
      return true;
    }
  }
  return false;
}
