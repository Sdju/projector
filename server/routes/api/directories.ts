import { listDirectories } from "../../modules/directories/index.ts";

import { HttpError } from "../../modules/http/index.ts";

import { terminalRequestAllowed } from "../../modules/terminal/index.ts";

import { json } from "../../modules/transport/index.ts";

import type { RouteContext } from "../../modules/transport/index.ts";

export async function handleDirectories({
  req,
  res,
  url,
  method,
  path,
}: RouteContext): Promise<boolean> {
  if (path === "/api/directories" && method === "GET") {
    if (!terminalRequestAllowed(req, false))
      throw new HttpError(403, "Папки доступны только со страницы Projector");
    res.setHeader("Cache-Control", "no-store");
    json(
      res,
      200,
      await listDirectories(
        url.searchParams.get("path") ?? "",
        url.searchParams.get("complete") === "true",
      ),
    );
    return true;
  }
  return false;
}
