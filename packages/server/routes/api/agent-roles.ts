import {
  createChatRole,
  deleteChatRole,
  resetServiceRole,
  roleSettings,
  saveChatRole,
  saveServiceRole,
} from "../../modules/agent-roles/index.ts";
import { isAgentBackend } from "../../modules/agent/index.ts";
import { accessAllowed } from "../../modules/access/index.ts";
import { HttpError } from "../../modules/http/index.ts";
import { json, readBody } from "../../modules/transport/index.ts";
import type { RouteDefinition } from "../../modules/transport/index.ts";
import { isServiceRoleId } from "@projector-ai/core/modules/agent-role/index.ts";

const pageOnly = (req: Parameters<typeof accessAllowed>[0], change = false) => {
  if (!accessAllowed(req, change))
    throw new HttpError(403, "Роли доступны только со страницы Projector");
};

/** A chat role from the request body; the id is part of the address, never of the payload. */
function chatRoleFrom(body: Record<string, unknown>): Record<string, unknown> {
  const role = body.role;
  if (!role || typeof role !== "object" || Array.isArray(role))
    throw new HttpError(400, "Укажите role");
  const value = role as Record<string, unknown>;
  if (value.kind !== undefined && value.kind !== "chat")
    throw new HttpError(400, "Пользовательская роль может быть только chat");
  if (typeof value.agent !== "string" || !isAgentBackend(value.agent))
    throw new HttpError(400, "Неизвестный агент роли");
  return value;
}

/** Built-in service roles and user-created chat roles. */
export const routes: RouteDefinition[] = [
  {
    method: "GET",
    path: "/api/agent/roles",
    handler: async ({ req, res }) => {
      pageOnly(req);
      res.setHeader("Cache-Control", "no-store");
      json(res, 200, await roleSettings());
    },
  },
  {
    method: "POST",
    path: "/api/agent/roles",
    handler: async ({ req, res }) => {
      pageOnly(req, true);
      res.setHeader("Cache-Control", "no-store");
      try {
        json(res, 201, await createChatRole(chatRoleFrom(await readBody(req))));
      } catch (error) {
        if (error instanceof HttpError) throw error;
        throw new HttpError(400, error instanceof Error ? error.message : "Неверная роль");
      }
    },
  },
  {
    method: "PUT",
    path: "/api/agent/roles/:id",
    handler: async ({ req, res, params }) => {
      pageOnly(req, true);
      res.setHeader("Cache-Control", "no-store");
      const id = decodeURIComponent(params.id ?? "");
      const body = await readBody(req);
      try {
        if (isServiceRoleId(id)) {
          const selection =
            body.selection && typeof body.selection === "object" && !Array.isArray(body.selection)
              ? body.selection
              : {};
          json(res, 200, await saveServiceRole(id, selection));
        } else {
          json(res, 200, await saveChatRole(id, chatRoleFrom(body)));
        }
      } catch (error) {
        if (error instanceof HttpError) throw error;
        throw new HttpError(
          400,
          error instanceof Error ? error.message : "Неверные настройки роли",
        );
      }
    },
  },
  {
    method: "DELETE",
    path: "/api/agent/roles/:id",
    handler: async ({ req, res, params }) => {
      pageOnly(req, true);
      res.setHeader("Cache-Control", "no-store");
      const id = decodeURIComponent(params.id ?? "");
      try {
        json(res, 200, await deleteChatRole(id));
      } catch (error) {
        throw new HttpError(400, error instanceof Error ? error.message : "Неверная роль");
      }
    },
  },
  {
    method: "POST",
    path: "/api/agent/roles/:id/reset",
    handler: async ({ req, res, params }) => {
      pageOnly(req, true);
      res.setHeader("Cache-Control", "no-store");
      const id = decodeURIComponent(params.id ?? "");
      try {
        json(res, 200, await resetServiceRole(id));
      } catch (error) {
        throw new HttpError(400, error instanceof Error ? error.message : "Неверная роль");
      }
    },
  },
];
