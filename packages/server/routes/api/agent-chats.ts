import {
  archiveLiveChat,
  forgetChat,
  listArchivedChats,
  openArchivedChat,
  readRecentChats,
  removeArchivedChat,
  renameArchivedChat,
} from "../../modules/agent/index.ts";
import { accessAllowed } from "../../modules/access/index.ts";
import { HttpError } from "../../modules/http/index.ts";
import { asString, json, readBody } from "../../modules/transport/index.ts";
import type { RouteContext, RouteDefinition } from "../../modules/transport/index.ts";

const pageOnly = (req: RouteContext["req"]) => {
  if (!accessAllowed(req, true))
    throw new HttpError(403, "Изменение доступно только со страницы Projector");
};

/** Past chats of the Projector agent: the live chat is put aside, listed, brought back or dropped. */
export const routes: RouteDefinition[] = [
  {
    method: "GET",
    path: "/api/agent/chats",
    handler: ({ res, url }) => {
      json(res, 200, { chats: listArchivedChats(url.searchParams.get("key") ?? "") });
    },
  },
  {
    method: "GET",
    path: "/api/agent/chats/recent",
    handler: ({ res, url }) => {
      const project = url.searchParams.get("projectId") ?? "";
      const backend = url.searchParams.get("backend") || undefined;
      json(res, 200, { chats: readRecentChats(project, backend) });
    },
  },
  {
    method: "POST",
    path: "/api/agent/chats/archive",
    handler: async ({ req, res }) => {
      pageOnly(req);
      const body = await readBody(req);
      json(res, 200, { id: (await archiveLiveChat(asString(body.key))) ?? null });
    },
  },
  {
    method: "POST",
    path: "/api/agent/chats/open",
    handler: async ({ req, res }) => {
      pageOnly(req);
      const body = await readBody(req);
      json(res, 200, { turns: await openArchivedChat(asString(body.key), asString(body.id)) });
    },
  },
  {
    method: "POST",
    path: "/api/agent/chats/update",
    handler: async ({ req, res }) => {
      pageOnly(req);
      const body = await readBody(req);
      renameArchivedChat(asString(body.id), {
        ...(typeof body.title === "string" ? { title: body.title } : {}),
        ...(typeof body.pinned === "boolean" ? { pinned: body.pinned } : {}),
      });
      json(res, 200, { ok: true });
    },
  },
  {
    method: "POST",
    path: "/api/agent/chats/delete",
    handler: async ({ req, res }) => {
      pageOnly(req);
      const body = await readBody(req);
      removeArchivedChat(asString(body.id));
      json(res, 200, { ok: true });
    },
  },
  {
    method: "POST",
    path: "/api/agent/chats/forget",
    handler: async ({ req, res }) => {
      pageOnly(req);
      const body = await readBody(req);
      json(res, 200, { ok: forgetChat(asString(body.projectId), asString(body.chat)) });
    },
  },
];
