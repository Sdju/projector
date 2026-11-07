import { HttpError } from "../../modules/http/index.ts";
import { proxyKey } from "../../modules/browser/index.ts";
import { json, type RouteDefinition } from "../../modules/transport/index.ts";
import { accessAllowed } from "../../modules/access/index.ts";

/**
 * Ключ origin прокси псевдобраузера. Его получает только страница Projector (проверка Origin):
 * по нему строятся адреса `*.proxy.localhost`, а чужие страницы их угадать не могут.
 */
export const routes: RouteDefinition[] = [
  {
    method: "GET",
    path: "/api/browser/session",
    handler: ({ req, res }) => {
      if (!accessAllowed(req, true))
        throw new HttpError(403, "Ключ доступен только странице Projector");
      res.setHeader("Cache-Control", "no-store");
      json(res, 200, { key: proxyKey() });
    },
  },
  {
    method: "",
    path: "/api/browser/session",
    handler: () => {
      throw new HttpError(405, "Допустим только GET");
    },
  },
];
