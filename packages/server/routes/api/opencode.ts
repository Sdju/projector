import { openCodeUsage } from "../../modules/agents-integration/opencode/index.ts";
import { loadOpenCodeTrajectory } from "../../modules/agents/opencode/index.ts";
import { accessAllowed } from "../../modules/access/index.ts";
import { loadAgentSession, projectWorktreeScope } from "../../modules/agent/index.ts";
import { splitFeaturePrompt } from "../../modules/agent-features/index.ts";
import { HttpError } from "../../modules/http/index.ts";
import { loadProjects } from "../../modules/projects/index.ts";
import { readBody, asString, json, type RouteDefinition } from "../../modules/transport/index.ts";
import { recordAgentLimits } from "../../modules/usage-analytics/index.ts";

export const routes: RouteDefinition[] = [
  {
    method: "GET",
    path: "/api/opencode/usage",
    handler: async ({ res }) => {
      res.setHeader("Cache-Control", "no-store");
      const value = await openCodeUsage();
      recordAgentLimits("opencode", value);
      json(res, 200, value);
    },
  },
  {
    method: "POST",
    path: "/api/opencode/trajectory",
    handler: async ({ req, res }) => {
      if (!accessAllowed(req, true))
        throw new HttpError(403, "Траектория доступна только со страницы Projector");
      const body = await readBody(req, 16_384);
      const sessionId = asString(body.sessionId);
      if (!sessionId) throw new HttpError(400, "Укажите sessionId");
      const projectId = asString(body.projectId);
      if (!projectId) throw new HttpError(400, "Укажите projectId");
      const project = (await loadProjects()).find((item) => item.id === projectId);
      if (!project) throw new HttpError(404, "Проект не найден");
      res.setHeader("Cache-Control", "no-store");
      const abort = new AbortController();
      const close = () => abort.abort();
      res.once("close", close);
      try {
        if (res.destroyed) return;
        const result = await loadOpenCodeTrajectory(
          {
            sessionId,
            project: { cwd: project.path, worktrees: projectWorktreeScope(project.id) },
            format: body.format === "turns" ? "turns" : "records",
          },
          abort.signal,
        );
        if (result.kind === "records") {
          res.statusCode = 200;
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.end(result.json);
          return;
        }
        const turns = await loadAgentSession("opencode", result.cwd, sessionId);
        const first = turns.find((turn) => turn.role === "user");
        if (first) {
          const { text, injected } = splitFeaturePrompt(first.text);
          first.text = text;
          if (injected) first.injected = injected;
        }
        if (!abort.signal.aborted) json(res, 200, { turns });
      } catch (error) {
        if (!abort.signal.aborted) throw error;
      } finally {
        res.off("close", close);
      }
    },
  },
];
