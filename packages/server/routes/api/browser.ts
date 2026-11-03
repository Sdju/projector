import { HttpError } from "../../modules/http/index.ts";
import { proxyKey } from "../../modules/browser/index.ts";
import { json } from "../../modules/transport/index.ts";
import { accessAllowed } from "../../modules/access/index.ts";
import type { RouteContext } from "../../modules/transport/index.ts";

/**
 * Ключ origin прокси псевдобраузера. Его получает только страница Projector (проверка Origin):
 * по нему строятся адреса `*.proxy.localhost`, а чужие страницы их угадать не могут.
 */
export async function handleBrowser({ req, res, path, method }: RouteContext): Promise<boolean> {
  if (path !== "/api/browser/session") return false;
  if (method !== "GET") throw new HttpError(405, "Допустим только GET");
  if (!accessAllowed(req, true))
    throw new HttpError(403, "Ключ доступен только странице Projector");
  res.setHeader("Cache-Control", "no-store");
  json(res, 200, { key: proxyKey() });
  return true;
}
