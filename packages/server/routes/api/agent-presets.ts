import {
  createPreset,
  createProjectPreset,
  deletePreset,
  deleteProjectPreset,
  presetBundle,
  savePreset,
  saveProjectPreset,
  setProjectPresetTrust,
} from "../../modules/agent-presets/index.ts";
import { accessAllowed } from "../../modules/access/index.ts";
import { HttpError } from "../../modules/http/index.ts";
import { asString, json, readBody } from "../../modules/transport/index.ts";
import type { RouteContext, RouteDefinition } from "../../modules/transport/index.ts";

const pageOnly = (req: RouteContext["req"], change = false) => {
  if (!accessAllowed(req, change))
    throw new HttpError(403, "Пресеты доступны только со страницы Projector");
};

function projectIdOf(value: unknown): string {
  return asString(value).trim();
}

function presetFrom(body: Record<string, unknown>): Record<string, unknown> {
  const preset = body.preset;
  if (!preset || typeof preset !== "object" || Array.isArray(preset))
    throw new HttpError(400, "Укажите preset");
  return preset as Record<string, unknown>;
}

/** Starter requests of every agent: the user's presets and a project's trusted file. */
export const routes: RouteDefinition[] = [
  {
    method: "GET",
    path: "/api/agent/presets",
    handler: async ({ req, res, url }) => {
      pageOnly(req);
      res.setHeader("Cache-Control", "no-store");
      const projectId = projectIdOf(url.searchParams.get("projectId"));
      try {
        json(res, 200, await presetBundle(projectId || undefined));
      } catch (error) {
        throw new HttpError(400, error instanceof Error ? error.message : "Неверный проект");
      }
    },
  },
  {
    method: "POST",
    path: "/api/agent/presets",
    handler: async ({ req, res }) => {
      pageOnly(req, true);
      res.setHeader("Cache-Control", "no-store");
      const body = await readBody(req);
      const projectId = projectIdOf(body.projectId);
      try {
        if (projectId) await createProjectPreset(projectId, presetFrom(body));
        else await createPreset(presetFrom(body));
        json(res, 201, await presetBundle(projectId || undefined));
      } catch (error) {
        if (error instanceof HttpError) throw error;
        throw new HttpError(400, error instanceof Error ? error.message : "Неверный пресет");
      }
    },
  },
  {
    method: "PUT",
    path: "/api/agent/presets/trust",
    handler: async ({ req, res }) => {
      pageOnly(req, true);
      res.setHeader("Cache-Control", "no-store");
      const body = await readBody(req);
      const projectId = projectIdOf(body.projectId);
      if (!projectId) throw new HttpError(400, "Укажите projectId");
      if (typeof body.trusted !== "boolean")
        throw new HttpError(400, "trusted должен быть boolean");
      try {
        await setProjectPresetTrust(projectId, body.trusted);
        json(res, 200, await presetBundle(projectId));
      } catch (error) {
        if (error instanceof HttpError) throw error;
        throw new HttpError(400, error instanceof Error ? error.message : "Неверное доверие");
      }
    },
  },
  {
    method: "PUT",
    path: "/api/agent/presets/:id",
    handler: async ({ req, res, params }) => {
      pageOnly(req, true);
      res.setHeader("Cache-Control", "no-store");
      const body = await readBody(req);
      const projectId = projectIdOf(body.projectId);
      const id = decodeURIComponent(params.id ?? "");
      try {
        if (projectId) await saveProjectPreset(projectId, id, presetFrom(body));
        else await savePreset(id, presetFrom(body));
        json(res, 200, await presetBundle(projectId || undefined));
      } catch (error) {
        if (error instanceof HttpError) throw error;
        throw new HttpError(400, error instanceof Error ? error.message : "Неверный пресет");
      }
    },
  },
  {
    method: "DELETE",
    path: "/api/agent/presets/:id",
    handler: async ({ req, res, params, url }) => {
      pageOnly(req, true);
      res.setHeader("Cache-Control", "no-store");
      const projectId = projectIdOf(url.searchParams.get("projectId"));
      const id = decodeURIComponent(params.id ?? "");
      try {
        if (projectId) await deleteProjectPreset(projectId, id);
        else await deletePreset(id);
        json(res, 200, await presetBundle(projectId || undefined));
      } catch (error) {
        throw new HttpError(400, error instanceof Error ? error.message : "Неверный пресет");
      }
    },
  },
];
