import {
  archiveLiveChat,
  listArchivedChats,
  openArchivedChat,
  removeArchivedChat,
  renameArchivedChat,
} from "../../modules/agent/index.ts";
import { accessAllowed } from "../../modules/access/index.ts";
import { HttpError } from "../../modules/http/index.ts";
import { asString, json, readBody } from "../../modules/transport/index.ts";
import type { RouteContext } from "../../modules/transport/index.ts";

/** Past chats of the Projector agent: the live chat is put aside, listed, brought back or dropped. */
export async function handleAgentChats({ req, res, url, method, path }: RouteContext) {
  if (path === "/api/agent/chats" && method === "GET") {
    json(res, 200, { chats: listArchivedChats(url.searchParams.get("key") ?? "") });
    return true;
  }
  if (!path.startsWith("/api/agent/chats/") || method !== "POST") return false;
  if (!accessAllowed(req, true))
    throw new HttpError(403, "Изменение доступно только со страницы Projector");
  const body = await readBody(req);
  const action = path.slice("/api/agent/chats/".length);
  if (action === "archive") {
    json(res, 200, { id: (await archiveLiveChat(asString(body.key))) ?? null });
    return true;
  }
  if (action === "open") {
    json(res, 200, { turns: await openArchivedChat(asString(body.key), asString(body.id)) });
    return true;
  }
  if (action === "update") {
    renameArchivedChat(asString(body.id), {
      ...(typeof body.title === "string" ? { title: body.title } : {}),
      ...(typeof body.pinned === "boolean" ? { pinned: body.pinned } : {}),
    });
    json(res, 200, { ok: true });
    return true;
  }
  if (action === "delete") {
    removeArchivedChat(asString(body.id));
    json(res, 200, { ok: true });
    return true;
  }
  return false;
}
