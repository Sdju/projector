import {
  createProjectRole,
  deleteProjectRole,
  projectRoleState,
  saveProjectRole,
  setProjectRoleTrust,
} from "../../modules/agent-roles/index.ts";
import { isAgentBackend } from "../../modules/agent/index.ts";
import { accessAllowed } from "../../modules/access/index.ts";
import { auditProjectTrust } from "../../modules/project-trust/index.ts";
import { HttpError } from "../../modules/http/index.ts";
import { asString, json, readBody } from "../../modules/transport/index.ts";
import type { RouteContext, RouteDefinition } from "../../modules/transport/index.ts";

const pageOnly = (req: RouteContext["req"], change = false) => {
  if (!accessAllowed(req, change))
    throw new HttpError(403, "Роли проекта доступны только со страницы Projector");
};

function projectIdOf(value: unknown): string {
  const id = asString(value).trim();
  if (!id) throw new HttpError(400, "Укажите projectId");
  return id;
}

function roleFrom(body: Record<string, unknown>): Record<string, unknown> {
  const role = body.role;
  if (!role || typeof role !== "object" || Array.isArray(role))
    throw new HttpError(400, "Укажите role");
  const value = role as Record<string, unknown>;
  if (value.kind !== undefined && value.kind !== "chat")
    throw new HttpError(400, "Роль проекта может быть только chat");
  if (typeof value.agent !== "string" || !isAgentBackend(value.agent))
    throw new HttpError(400, "Неизвестный агент роли");
  return value;
}

/** Roles stored in a project's `.projector/roles.json` and the trust decision for that file. */
export const routes: RouteDefinition[] = [
  {
    method: "GET",
    path: "/api/agent/project-roles",
    handler: async ({ req, res, url }) => {
      pageOnly(req);
      res.setHeader("Cache-Control", "no-store");
      try {
        json(res, 200, await projectRoleState(projectIdOf(url.searchParams.get("projectId"))));
      } catch (error) {
        throw new HttpError(400, error instanceof Error ? error.message : "Неверный проект");
      }
    },
  },
  {
    method: "POST",
    path: "/api/agent/project-roles",
    handler: async ({ req, res }) => {
      pageOnly(req, true);
      res.setHeader("Cache-Control", "no-store");
      const body = await readBody(req);
      const projectId = projectIdOf(body.projectId);
      try {
        const state = await createProjectRole(projectId, roleFrom(body));
        void auditProjectTrust(projectId);
        json(res, 201, state);
      } catch (error) {
        if (error instanceof HttpError) throw error;
        throw new HttpError(400, error instanceof Error ? error.message : "Неверная роль");
      }
    },
  },
  {
    method: "PUT",
    path: "/api/agent/project-roles/trust",
    handler: async ({ req, res }) => {
      pageOnly(req, true);
      res.setHeader("Cache-Control", "no-store");
      const body = await readBody(req);
      if (typeof body.trusted !== "boolean")
        throw new HttpError(400, "trusted должен быть boolean");
      const projectId = projectIdOf(body.projectId);
      try {
        const state = await setProjectRoleTrust(projectId, body.trusted);
        void auditProjectTrust(projectId);
        json(res, 200, state);
      } catch (error) {
        if (error instanceof HttpError) throw error;
        throw new HttpError(400, error instanceof Error ? error.message : "Неверное доверие");
      }
    },
  },
  {
    method: "PUT",
    path: "/api/agent/project-roles/:id",
    handler: async ({ req, res, params }) => {
      pageOnly(req, true);
      res.setHeader("Cache-Control", "no-store");
      const body = await readBody(req);
      const id = decodeURIComponent(params.id ?? "");
      const projectId = projectIdOf(body.projectId);
      try {
        const state = await saveProjectRole(projectId, id, roleFrom(body));
        void auditProjectTrust(projectId);
        json(res, 200, state);
      } catch (error) {
        if (error instanceof HttpError) throw error;
        throw new HttpError(400, error instanceof Error ? error.message : "Неверная роль");
      }
    },
  },
  {
    method: "DELETE",
    path: "/api/agent/project-roles/:id",
    handler: async ({ req, res, params, url }) => {
      pageOnly(req, true);
      res.setHeader("Cache-Control", "no-store");
      const id = decodeURIComponent(params.id ?? "");
      const projectId = projectIdOf(url.searchParams.get("projectId"));
      try {
        const state = await deleteProjectRole(projectId, id);
        void auditProjectTrust(projectId);
        json(res, 200, state);
      } catch (error) {
        throw new HttpError(400, error instanceof Error ? error.message : "Неверная роль");
      }
    },
  },
];
