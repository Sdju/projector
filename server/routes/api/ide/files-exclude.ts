import { readFilesExclude, writeFilesExclude } from "../../../modules/workspace/index.ts";
import { json, readBody, type RouteContext } from "../../../modules/transport/index.ts";
import { accessAllowed } from "../../../modules/access/index.ts";
import { HttpError } from "../../../modules/http/index.ts";

export async function handleFilesExclude({ req, res, path, method }: RouteContext) {
  if (path !== "/api/ide/files-exclude") return false;
  if (!accessAllowed(req, method === "PUT"))
    throw new HttpError(403, "Настройки доступны только со страницы Projector");
  res.setHeader("Cache-Control", "no-store");
  if (method === "GET") json(res, 200, { exclude: await readFilesExclude() });
  else if (method === "PUT") {
    const body = await readBody(req);
    json(res, 200, { exclude: await writeFilesExclude(body.exclude ?? body) });
  } else json(res, 405, { error: "Метод не поддерживается" });
  return true;
}
